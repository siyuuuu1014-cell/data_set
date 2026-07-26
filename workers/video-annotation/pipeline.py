"""Annotation pipeline — orchestrates all providers sequentially.

Each provider is loaded → used → unloaded to stay within GPU memory budget.
"""

from __future__ import annotations

import logging
import re
import time
import unicodedata
from contextlib import contextmanager
from typing import Any

import numpy as np

from config import (
    DEFAULT_SAMPLE_FPS,
    DEFAULT_TRACK_LOW_THRESHOLD,
    LOCATE_ADAPTIVE_GENERATION_MODE,
    LOCATE_ADAPTIVE_MAX_CATEGORIES,
    LOCATE_ADAPTIVE_MAX_NEW_TOKENS,
    LOCATE_CATEGORY_MODE,
    TRACKER_BACKEND,
)
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

DEFAULT_GROUNDING_CATEGORIES = (
    "person", "man", "woman", "child", "adult", "teenager", "elderly",
    "car", "truck", "bus", "bicycle", "motorcycle", "chair", "table",
    "desk", "sofa", "bed", "cabinet", "shelf", "bench", "piano",
    "guitar", "violin", "drum", "instrument", "laptop", "phone",
    "television", "monitor", "keyboard", "mouse", "camera", "book",
    "newspaper", "magazine", "cup", "bottle", "bowl", "plate", "knife",
    "fork", "spoon", "backpack", "handbag", "suitcase", "bag", "hat",
    "glasses", "watch", "shoe", "clothing", "door", "window", "curtain",
    "lamp", "clock", "plant", "vase", "picture", "painting", "mirror",
    "dog", "cat", "bird", "ball", "toy", "food", "fruit", "cake",
    "pizza", "sandwich",
)

_ADAPTIVE_CORE_CATEGORIES = (
    "person", "man", "woman", "child", "adult", "clothing", "phone", "bag",
)

_ADAPTIVE_FILL_CATEGORIES = (
    "chair", "table", "car", "bottle", "cup", "backpack", "door", "window",
    "laptop", "television", "book", "shoe", "hat", "glasses", "food",
)


def _normalize_grounding_category(value: Any) -> str:
    """Normalize a model hint before adding it to an open-vocabulary prompt."""
    if not isinstance(value, str):
        return ""
    normalized = unicodedata.normalize("NFKC", value).strip()
    normalized = re.sub(r"\s+", " ", normalized.replace("_", " "))
    if not normalized or "</c>" in normalized or len(normalized) > 64:
        return ""
    return normalized


def _select_grounding_categories(
    explicit_categories: Any,
    detections: list[Any],
    semantic: Any,
) -> tuple[list[str], str]:
    """Choose a bounded LocateAnything query without hiding explicit choices.

    Custom categories always win. The default adaptive mode uses grounded YOLO
    classes and Qwen's semantic candidates, then fills a small common-object
    core. If neither provider supplies evidence, it falls back to the complete
    list so a provider failure cannot silently erase grounding coverage.
    """
    if isinstance(explicit_categories, (list, tuple)):
        custom: list[str] = []
        seen: set[str] = set()
        for value in explicit_categories:
            category = _normalize_grounding_category(value)
            key = category.casefold()
            if category and key not in seen:
                seen.add(key)
                custom.append(category)
        return custom, "custom"

    if LOCATE_CATEGORY_MODE == "full":
        return list(DEFAULT_GROUNDING_CATEGORIES), "full"

    evidence: list[str] = []

    for frame in detections:
        for detection in getattr(frame, "detections", []) or []:
            category = _normalize_grounding_category(
                detection.get("className") if isinstance(detection, dict) else ""
            )
            if category:
                evidence.append(category)

    if semantic is not None:
        person_attributes = getattr(semantic, "persons_attributes", []) or []
        if person_attributes:
            evidence.append("person")
        for person in person_attributes:
            if not isinstance(person, dict):
                continue
            gender = str(person.get("gender") or "").strip().lower()
            age_group = str(
                person.get("ageGroup") or person.get("age") or ""
            ).strip().lower()
            if gender == "male":
                evidence.append("man")
            elif gender == "female":
                evidence.append("woman")
            if age_group in {"child", "adult", "teenager", "elderly"}:
                evidence.append(age_group)
            if person.get("clothing"):
                evidence.append("clothing")

        for obj in getattr(semantic, "objects_attributes", []) or []:
            if not isinstance(obj, dict):
                continue
            category = _normalize_grounding_category(obj.get("name"))
            if category:
                evidence.append(category)

    if not evidence:
        return list(DEFAULT_GROUNDING_CATEGORIES), "full_fallback"

    selected: list[str] = []
    seen: set[str] = set()

    def add(values: Any) -> None:
        for value in values:
            category = _normalize_grounding_category(value)
            key = category.casefold()
            if (
                category
                and key not in seen
                and len(selected) < LOCATE_ADAPTIVE_MAX_CATEGORIES
            ):
                seen.add(key)
                selected.append(category)

    add(evidence)
    add(_ADAPTIVE_CORE_CATEGORIES)
    add(_ADAPTIVE_FILL_CATEGORIES)
    return selected, "adaptive"


def _deduplicate_ocr_texts(items: list[dict]) -> list[dict]:
    """Keep one highest-confidence result for text repeated across keyframes."""
    best_by_text: dict[str, dict] = {}
    order: list[str] = []
    for item in items:
        text = str(item.get("text") or "").strip()
        normalized = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).casefold()
        if not normalized:
            continue
        previous = best_by_text.get(normalized)
        if previous is None:
            order.append(normalized)
        previous_score = previous.get("confidence") if previous else None
        current_score = item.get("confidence")
        if previous is None or (
            isinstance(current_score, (int, float))
            and not isinstance(previous_score, (int, float))
        ) or (
            isinstance(current_score, (int, float))
            and isinstance(previous_score, (int, float))
            and current_score > previous_score
        ):
            best_by_text[normalized] = {**item, "text": text}
    return [best_by_text[key] for key in order]


def _degraded_visual_providers(
    provider_results: dict[str, dict[str, Any]],
    visual_provider_enabled: dict[str, bool],
) -> list[str]:
    """Return enabled visual providers whose result makes the segment partial."""
    degraded: list[str] = []
    for provider_id in ("yolo", "tracker", "locate_anything", "qwen_vl"):
        if not visual_provider_enabled.get(provider_id, False):
            continue

        result = provider_results.get(provider_id, {})
        if result.get("status") == "completed":
            continue
        if (
            provider_id == "tracker"
            and result.get("status") == "skipped"
            and result.get("reason") == "no_detections"
        ):
            continue
        degraded.append(provider_id)
    return degraded


def _detector_confidence_for_tracking(
    visual_provider_enabled: dict[str, bool],
) -> float | None:
    """Keep low-score boxes only when the real ByteTrack backend can use them."""
    if (
        visual_provider_enabled.get("tracker", False)
        and TRACKER_BACKEND == "bytetrack"
    ):
        return DEFAULT_TRACK_LOW_THRESHOLD
    return None


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
    explicit_categories = opts.get("categories")

    errors: list[str] = []
    visual_provider_enabled = {
        provider_id: is_provider_enabled(provider_id, opts)
        for provider_id in ("yolo", "tracker", "locate_anything", "qwen_vl")
    }
    provider_results: dict[str, dict[str, Any]] = {
        provider_id: {
            "status": "pending" if enabled else "disabled",
        }
        for provider_id, enabled in visual_provider_enabled.items()
    }
    recognition_status: dict[str, dict[str, Any]] = {
        "ocr": {"status": "pending", "count": 0},
        "speech": {"status": "pending", "count": 0},
    }

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

    if not visual_provider_enabled["yolo"]:
        provider_results["yolo"] = {"status": "disabled"}
    elif not frames:
        provider_results["yolo"] = {"status": "skipped", "reason": "no_detection_frames"}
    else:
        try:
            with _loaded_provider("yolo") as detector:
                detections = detector.detect_frames(
                    frames,
                    conf=_detector_confidence_for_tracking(
                        visual_provider_enabled,
                    ),
                )
                logger.info("YOLO11: %d frames detected", len(detections))
            provider_results["yolo"] = {"status": "completed"}
        except Exception as e:
            errors.append(f"YOLO11 detection failed: {e}")
            provider_results["yolo"] = {"status": "failed", "error": str(e)}
            logger.warning("YOLO11 failed (will skip): %s", e)

    # ── Phase 2: ByteTrack tracking ────────────────────
    _report(progress_cb, "ByteTrack tracking", 25)
    if not visual_provider_enabled["tracker"]:
        provider_results["tracker"] = {"status": "disabled"}
    elif not detections:
        provider_results["tracker"] = {"status": "skipped", "reason": "no_detections"}
    else:
        try:
            with _loaded_provider("tracker") as tracker:
                tracks = tracker.track(detections, f"seg_{int(segment_start)}")
                logger.info("ByteTrack: %d frame tracks", len(tracks))
            provider_results["tracker"] = {"status": "completed"}
        except Exception as e:
            errors.append(f"ByteTrack tracking failed: {e}")
            provider_results["tracker"] = {"status": "failed", "error": str(e)}
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

    # Phase 3: Qwen3-VL semantic attributes. Semantic candidates also keep the
    # following open-vocabulary grounding query bounded.
    _report(progress_cb, "Qwen3-VL semantic", 45)
    semantic: Any = None
    if not visual_provider_enabled["qwen_vl"]:
        provider_results["qwen_vl"] = {"status": "disabled"}
    elif not keyframe_paths:
        provider_results["qwen_vl"] = {"status": "skipped", "reason": "no_keyframe"}
    else:
        try:
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
            provider_results["qwen_vl"] = {"status": "completed"}
        except ImportError as e:
            message = f"Qwen3-VL not installed: {e}"
            errors.append(f"Qwen3-VL semantic failed: {message}")
            provider_results["qwen_vl"] = {"status": "failed", "error": message}
            logger.warning("Qwen3-VL not installed — skipping")
        except Exception as e:
            errors.append(f"Qwen3-VL semantic failed: {e}")
            provider_results["qwen_vl"] = {"status": "failed", "error": str(e)}
            logger.warning("Qwen3-VL failed (will skip): %s", e)

    # Phase 4: LocateAnything-3B fine-grained
    _report(progress_cb, "LocateAnything grounding", 60)
    fine_objects: list[dict] = []
    grounding_categories, category_mode = _select_grounding_categories(
        explicit_categories,
        detections,
        semantic,
    )
    logger.info(
        "LocateAnything category selection: mode=%s selected=%d full=%d",
        category_mode,
        len(grounding_categories),
        len(DEFAULT_GROUNDING_CATEGORIES),
    )
    if not visual_provider_enabled["locate_anything"]:
        provider_results["locate_anything"] = {"status": "disabled"}
    elif not keyframe_paths:
        provider_results["locate_anything"] = {"status": "skipped", "reason": "no_keyframe"}
    else:
        try:
            with _loaded_provider("locate_anything") as grounding:
                adaptive_kwargs = (
                    {
                        "generation_mode": LOCATE_ADAPTIVE_GENERATION_MODE,
                        "max_new_tokens": LOCATE_ADAPTIVE_MAX_NEW_TOKENS,
                    }
                    if category_mode == "adaptive"
                    else {}
                )
                fine_objects = grounding.detect_objects(
                    keyframe_paths[0],
                    grounding_categories,
                    **adaptive_kwargs,
                )
                if (
                    category_mode == "adaptive"
                    and LOCATE_ADAPTIVE_GENERATION_MODE == "fast"
                    and grounding_categories
                    and not fine_objects
                ):
                    logger.warning(
                        "LocateAnything fast mode returned no boxes; "
                        "retrying bounded hybrid mode"
                    )
                    fine_objects = grounding.detect_objects(
                        keyframe_paths[0],
                        grounding_categories,
                        generation_mode="hybrid",
                        max_new_tokens=LOCATE_ADAPTIVE_MAX_NEW_TOKENS,
                    )
                logger.info("LocateAnything: %d objects", len(fine_objects))
            provider_results["locate_anything"] = {"status": "completed"}
        except ImportError as e:
            message = f"LocateAnything not installed: {e}"
            errors.append(f"LocateAnything grounding failed: {message}")
            provider_results["locate_anything"] = {"status": "failed", "error": message}
            logger.warning("LocateAnything not installed — skipping")
        except Exception as e:
            errors.append(f"LocateAnything grounding failed: {e}")
            provider_results["locate_anything"] = {"status": "failed", "error": str(e)}
            logger.warning("LocateAnything failed (will skip): %s", e)
            # Continue with other phases — partial results are better than nothing

    # ── Phase 5: scene-text detection and recognition ──
    _report(progress_cb, "OCR text recognition", 70)
    ocr_texts: list[dict] = []
    ocr_enabled = is_provider_enabled("trocr", opts)
    if not ocr_enabled:
        recognition_status["ocr"] = {"status": "disabled", "count": 0}
    elif not keyframe_paths:
        recognition_status["ocr"] = {
            "status": "skipped",
            "count": 0,
            "reason": "no_keyframe",
        }
    else:
        frame_results: list[dict] = []
        frame_errors: list[str] = []
        successful_frames = 0
        try:
            with _loaded_provider("trocr") as ocr:
                for frame_index, keyframe_path in enumerate(keyframe_paths):
                    try:
                        frame_results.extend(ocr.extract_text(keyframe_path))
                        successful_frames += 1
                    except Exception as frame_error:
                        frame_errors.append(f"keyframe {frame_index + 1}: {frame_error}")

            if successful_frames == 0 and frame_errors:
                raise RuntimeError("; ".join(frame_errors))

            ocr_texts = _deduplicate_ocr_texts(frame_results)
            logger.info(
                "RapidOCR: %d unique text regions across %d/%d keyframes",
                len(ocr_texts),
                successful_frames,
                len(keyframe_paths),
            )
            recognition_status["ocr"] = {
                "status": "completed" if ocr_texts else "no_content",
                "count": len(ocr_texts),
            }
            if frame_errors:
                errors.append(f"OCR text recognition partially failed: {'; '.join(frame_errors)}")
        except Exception as e:
            errors.append(f"OCR text recognition failed: {e}")
            recognition_status["ocr"] = {
                "status": "failed",
                "count": 0,
                "error": str(e),
            }
            logger.warning("RapidOCR failed (will skip): %s", e)

    # ── Phase 6: Whisper STT ──────────────────────────
    _report(progress_cb, "Speech-to-text", 75)
    transcript: dict = {}
    whisper_enabled = is_provider_enabled("whisper", opts)
    if not whisper_enabled:
        recognition_status["speech"] = {"status": "disabled", "count": 0}
    else:
        has_audio: bool | None = None
        try:
            has_audio = get_video_metadata(video_path).has_audio
        except Exception as metadata_error:
            logger.warning(
                "Unable to inspect audio stream; Whisper will try directly: %s",
                metadata_error,
            )

        if has_audio is False:
            recognition_status["speech"] = {"status": "no_audio", "count": 0}
            logger.info("Whisper skipped: video has no audio stream")
        else:
            try:
                with _loaded_provider("whisper") as whisper:
                    transcript = whisper.transcribe(video_path, segment_start, segment_end)
                    if transcript:
                        logger.info("Whisper: transcript acquired")
                recognition_status["speech"] = {
                    "status": "completed" if transcript.get("text") else "no_content",
                    "count": 1 if transcript.get("text") else 0,
                }
            except Exception as e:
                errors.append(f"Whisper STT failed: {e}")
                recognition_status["speech"] = {
                    "status": "failed",
                    "count": 0,
                    "error": str(e),
                }
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
        recognition_status=recognition_status,
        video_width=video_w,
        video_height=video_h,
        person_ids=person_ids,
    )

    if errors:
        merged["_pipeline_errors"] = errors
    degraded_providers = _degraded_visual_providers(
        provider_results,
        visual_provider_enabled,
    )
    merged["_provider_statuses"] = provider_results
    merged["_pipeline_status"] = "partial_completed" if degraded_providers else "completed"

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
