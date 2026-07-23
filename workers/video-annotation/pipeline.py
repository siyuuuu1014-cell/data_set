"""Annotation pipeline — orchestrates all providers sequentially.

Each provider is loaded → used → unloaded to stay within GPU memory budget.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any

import numpy as np

from config import DEFAULT_SAMPLE_FPS
from providers.depth.base import DepthResult
from providers.registry import create_provider, is_provider_enabled, mark_loaded
from services.frame_sampling import (
    extract_frames,
    extract_segment_keyframes,
    load_frames,
)
from services.merge_service import merge_results
from services.scene_detection import detect_scenes
from services.video_identity import assign_fallback_identities, assign_video_identities
from services.video_metadata import get_video_metadata

logger = logging.getLogger(__name__)


@contextmanager
def _loaded_provider(provider_id: str):
    """Load one optional provider and always release its resources."""
    provider = create_provider(provider_id)
    try:
        provider.load()
        mark_loaded(provider_id, True)
        yield provider
    finally:
        try:
            provider.unload()
        finally:
            mark_loaded(provider_id, False)


def run_scene_detection(video_path: str, threshold: float = 0.4) -> dict:
    """Detect scene boundaries and return segments with metadata."""
    logger.info("Running scene detection on: %s (threshold=%.2f)", video_path, threshold)

    metadata = get_video_metadata(video_path)
    logger.info(
        "Video: %.1fs, %.1f fps, %dx%d",
        metadata.duration, metadata.fps, metadata.width, metadata.height,
    )

    segments = detect_scenes(video_path, threshold=threshold)
    logger.info("Detected %d segments", len(segments))

    return {
        "segments": [
            {"segment_id": s.segment_id, "start": s.start, "end": s.end}
            for s in segments
        ],
        "metadata": {
            "duration": metadata.duration,
            "fps": metadata.fps,
            "width": metadata.width,
            "height": metadata.height,
        },
    }


def run_annotation_pipeline(
    video_path: str,
    segment_start: float,
    segment_end: float,
    options: dict | None = None,
    progress_cb: Any = None,
) -> dict:
    """Execute the full annotation pipeline for one video segment.

    Args:
        video_path: Absolute path to the video file.
        segment_start: Start time in seconds.
        segment_end: End time in seconds.
        options: Additional configuration:
            - categories: list[str] — categories for LocateAnything
            - ontology: dict — ontology for Qwen semantic
            - prompt_template: str
            - examples: list[dict]
            - sample_fps: float
        progress_cb: Optional callback(phase, pct) for progress reporting.

    Returns:
        SegmentAnnotation dict matching the JSON schema.
    """
    opts = options or {}
    sample_fps = opts.get("sample_fps", DEFAULT_SAMPLE_FPS)
    categories = opts.get("categories", ["person","man","woman","child","adult","teenager","elderly","car","truck","bus","bicycle","motorcycle","chair","table","desk","sofa","bed","cabinet","shelf","bench","piano","guitar","violin","drum","instrument","laptop","phone","television","monitor","keyboard","mouse","camera","book","newspaper","magazine","cup","bottle","bowl","plate","knife","fork","spoon","backpack","handbag","suitcase","bag","hat","glasses","watch","shoe","clothing","door","window","curtain","lamp","clock","plant","vase","picture","painting","mirror","dog","cat","bird","ball","toy","food","fruit","cake","pizza","sandwich"])

    errors: list[str] = []

    t0 = time.perf_counter()

    # ── Phase 1: YOLO11 per-frame detection ────────────
    _report(progress_cb, "YOLO11 detection", 5)
    frames: list = []
    detections = []
    tracks: list = []
    person_ids: dict[int, str] = {}
    try:
        frames_paths = extract_frames(video_path, segment_start, segment_end, fps=sample_fps)
        frames = load_frames(frames_paths)
        logger.info("Extracted %d frames @ %.1f fps", len(frames), sample_fps)
    except Exception as e:
        errors.append(f"Frame extraction failed: {e}")
        logger.warning("Frame extraction failed (will skip detection): %s", e)

    if frames and is_provider_enabled("yolo", opts):
        try:
            with _loaded_provider("yolo") as detector:
                detections = detector.detect_frames(frames)
                logger.info("YOLO11: %d frames detected", len(detections))
        except Exception as e:
            errors.append(f"YOLO11 detection failed: {e}")
            logger.warning("YOLO11 failed (will skip): %s", e)

    # ── Phase 2: ByteTrack tracking ────────────────────
    _report(progress_cb, "ByteTrack tracking", 25)
    if detections and is_provider_enabled("tracker", opts):
        try:
            with _loaded_provider("tracker") as tracker:
                tracks = tracker.track(detections, f"seg_{int(segment_start)}")
                logger.info("ByteTrack: %d frame tracks", len(tracks))
        except Exception as e:
            errors.append(f"ByteTrack tracking failed: {e}")
            logger.warning("ByteTrack failed (will skip): %s", e)

    # Convert segment-local tracker IDs to video-scoped IDs before any
    # downstream provider consumes them. Registry failures use a deterministic
    # segment namespace so duplicate IDs are never reintroduced.
    if tracks:
        video_id = str(opts.get("video_id") or "")
        segment_id = opts.get("segment_id")
        try:
            identity_assignment = assign_video_identities(
                tracks,
                video_id=video_id,
                video_path=video_path,
                segment_id=segment_id,
                segment_start=segment_start,
                segment_end=segment_end,
            )
        except Exception as e:
            logger.warning("Video identity registry unavailable; using deterministic IDs: %s", e)
            errors.append(f"Video identity registry fallback: {e}")
            identity_assignment = assign_fallback_identities(
                tracks,
                video_id=video_id,
                video_path=video_path,
                segment_id=segment_id,
                segment_start=segment_start,
            )
        person_ids = identity_assignment.person_ids

    # Extract keyframes once (shared by phases 3-7)
    keyframe_paths: list[str] = []
    try:
        keyframe_paths = extract_segment_keyframes(video_path, segment_start, segment_end, duration=segment_end)
    except Exception as e:
        errors.append(f"Keyframe extraction failed: {e}")
        logger.warning("Keyframe extraction failed (will skip visual phases): %s", e)

    # Phase 3: LocateAnything-3B fine-grained
    _report(progress_cb, "LocateAnything grounding", 45)
    fine_objects: list[dict] = []
    try:
        if keyframe_paths and is_provider_enabled("locate_anything", opts):
            with _loaded_provider("locate_anything") as grounding:
                fine_objects = grounding.detect_objects(keyframe_paths[0], categories)
                logger.info("LocateAnything: %d objects", len(fine_objects))
    except ImportError:
        logger.warning("LocateAnything not installed — skipping")
    except Exception as e:
        errors.append(f"LocateAnything grounding failed: {e}")
        logger.warning("LocateAnything failed (will skip): %s", e)
        # Continue with other phases — partial results are better than nothing

    # Phase 4: Qwen3-VL semantic attributes
    _report(progress_cb, "Qwen3-VL semantic", 60)
    semantic: Any = None
    try:
        if keyframe_paths and is_provider_enabled("qwen_vl", opts):
            with _loaded_provider("qwen_vl") as semantic_provider:
                semantic = semantic_provider.annotate_semantic(
                    video_path=video_path,
                    frame_paths=keyframe_paths,
                    start=segment_start,
                    end=segment_end,
                    ontology=opts.get("ontology", {}),
                    prompt_template=opts.get("prompt_template", ""),
                    examples=opts.get("examples"),
                )
                logger.info("Qwen3-VL: semantic complete")
    except ImportError:
        logger.warning("Qwen3-VL not installed — skipping")
    except Exception as e:
        errors.append(f"Qwen3-VL semantic failed: {e}")
        logger.warning("Qwen3-VL failed (will skip): %s", e)

    # ── Phase 5: TrOCR text extraction ────────────────
    _report(progress_cb, "OCR text recognition", 70)
    ocr_texts: list[dict] = []
    try:
        if keyframe_paths and is_provider_enabled("trocr", opts):
            with _loaded_provider("trocr") as ocr:
                ocr_texts = ocr.extract_text(keyframe_paths[0])
                logger.info("TrOCR: %d text regions", len(ocr_texts))
    except Exception as e:
        errors.append(f"TrOCR text recognition failed: {e}")
        logger.warning("TrOCR failed (will skip): %s", e)

    # ── Phase 6: Whisper STT ──────────────────────────
    _report(progress_cb, "Speech-to-text", 75)
    transcript: dict = {}
    try:
        if is_provider_enabled("whisper", opts):
            with _loaded_provider("whisper") as whisper:
                transcript = whisper.transcribe(video_path, segment_start, segment_end)
                if transcript:
                    logger.info("Whisper: transcript acquired")
    except Exception as e:
        errors.append(f"Whisper STT failed: {e}")
        logger.warning("Whisper STT failed (will skip): %s", e)

    # ── Phase 7: Depth Anything v2 ─────────────────────
    _report(progress_cb, "Depth estimation", 85)
    depth_result = DepthResult(depth_map=np.array([]), mean_depth_meters=0.0, objects_depths=[])
    try:
        # Build bbox list from tracks for depth estimation
        bboxes_for_depth: list[dict] = []
        seen_tids: set[int] = set()
        for ft in tracks:
            for t in ft.tracks:
                tid = t["trackId"]
                if tid not in seen_tids:
                    seen_tids.add(tid)
                    bboxes_for_depth.append({
                        "trackId": tid,
                        "bbox": t["bbox"],
                    })

        if keyframe_paths and is_provider_enabled("depth_anything", opts):
            with _loaded_provider("depth_anything") as depth_estimator:
                depth_result = depth_estimator.estimate_depth(keyframe_paths[0], bboxes_for_depth)
                logger.info("Depth: %d objects estimated", len(depth_result.objects_depths))
    except ImportError:
        logger.warning("Depth Anything not installed — skipping")
    except Exception as e:
        errors.append(f"Depth estimation failed: {e}")
        logger.warning("Depth estimation failed (will skip): %s", e)

    # ── Phase 6: Merge ─────────────────────────────────
    _report(progress_cb, "Merging results", 90)

    # Get video dimensions from first frame
    video_w, video_h = 1920, 1080
    if frames and len(frames) > 0:
        video_h, video_w = frames[0].shape[:2]

    merged = merge_results(
        tracks=tracks,
        fine_objects=fine_objects,
        semantic=semantic,
        depth_result=depth_result,
        ocr_texts=ocr_texts,
        transcript=transcript,
        video_width=video_w,
        video_height=video_h,
        person_ids=person_ids,
    )

    if errors:
        merged["_pipeline_errors"] = errors

    elapsed = time.perf_counter() - t0
    logger.info("Pipeline complete in %.1fs", elapsed)
    _report(progress_cb, "Complete", 100)

    return merged


def _report(cb: Any, phase: str, pct: int) -> None:
    if cb:
        try:
            cb(phase, pct)
        except Exception:
            pass
