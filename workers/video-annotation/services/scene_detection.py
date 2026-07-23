"""PySceneDetect wrapper — automatic shot boundary detection."""

from __future__ import annotations

import logging

from config import SCENE_THRESHOLD

logger = logging.getLogger(__name__)

# Default values
DEFAULT_MIN_LENGTH = 0.5
DEFAULT_MAX_LENGTH = 10.0
DEFAULT_OVERLONG_SPLIT = 8.0


class Segment:
    def __init__(self, segment_id: int, start: float, end: float) -> None:
        self.segment_id = segment_id
        self.start = start
        self.end = end


def detect_scenes(
    video_path: str,
    min_length: float = DEFAULT_MIN_LENGTH,
    max_length: float = DEFAULT_MAX_LENGTH,
    overlong_split: float = DEFAULT_OVERLONG_SPLIT,
    threshold: float = 0.4,
) -> list[Segment]:
    """Detect shot/scene boundaries using PySceneDetect.

    Uses ContentDetector as primary, AdaptiveDetector as fallback.
    Over-long segments are split further.
    threshold: 0-1 sensitivity (lower = more segments)
    """
    try:
        from scenedetect import ContentDetector, SceneManager, open_video
    except ImportError:
        logger.warning("PySceneDetect not installed — using ffmpeg fallback")
        return _detect_scenes_ffmpeg(video_path, max_length, threshold)

    logger.info("Detecting scenes in: %s (threshold=%.2f)", video_path, threshold)

    try:
        video = open_video(video_path)
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(threshold=min(255, max(1, int(threshold * 255)))))
        scene_manager.detect_scenes(video)

        raw_scenes = scene_manager.get_scene_list()

        if not raw_scenes:
            # Fallback: single segment for entire video
            duration = video.duration.get_seconds()
            return [Segment(segment_id=1, start=0.0, end=duration)]

        # Filter + split
        segments: list[Segment] = []
        seg_id = 1

        for scene in raw_scenes:
            start_sec = scene[0].get_seconds()
            end_sec = scene[1].get_seconds()
            length = end_sec - start_sec

            if length < min_length:
                # Merge with previous if possible
                if segments:
                    segments[-1].end = end_sec
                else:
                    segments.append(Segment(seg_id, start_sec, end_sec))
                    seg_id += 1
                continue

            if length > overlong_split:
                # Split into chunks
                chunks = _split_range(start_sec, end_sec, overlong_split)
                for c_start, c_end in chunks:
                    segments.append(Segment(seg_id, c_start, c_end))
                    seg_id += 1
            else:
                segments.append(Segment(seg_id, start_sec, end_sec))
                seg_id += 1

        return segments

    except Exception:
        logger.exception("PySceneDetect failed")
        return []


def _split_range(start: float, end: float, chunk_size: float) -> list[tuple[float, float]]:
    """Split [start, end) into chunks of approximately chunk_size seconds."""
    chunks: list[tuple[float, float]] = []
    pos = start
    while pos < end:
        nxt = min(pos + chunk_size, end)
        chunks.append((pos, nxt))
        pos = nxt
    return chunks


def _detect_scenes_ffmpeg(video_path: str, max_length: float, threshold: float = 0.4) -> list[Segment]:
    """Fallback scene detection using ffmpeg scene filter."""
    import subprocess

    from config import FFMPEG_PATH
    from services.video_metadata import get_video_metadata

    # Get actual video duration for fallback segment bounds
    try:
        meta = get_video_metadata(video_path)
        duration = meta.duration
    except Exception:
        duration = max_length * 10  # rough estimate

    cmd = [
        FFMPEG_PATH, "-i", video_path,
        "-vf", f"select='gt(scene,{threshold})',metadata=print:file=-",
        "-vsync", "vfr", "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=120)
    except Exception:
        return [Segment(segment_id=1, start=0.0, end=duration)]

    # Parse timestamps from ffmpeg output
    timestamps: list[float] = [0.0]
    for line in result.stderr.split("\n"):
        if "pts_time:" in line:
            try:
                t = float(line.split("pts_time:")[1].strip())
                if t > timestamps[-1] + 0.5:  # minimum gap
                    timestamps.append(t)
            except (ValueError, IndexError):
                pass

    if len(timestamps) <= 1:
        return [Segment(segment_id=1, start=0.0, end=duration)]

    segments: list[Segment] = []
    seg_id = 1
    for i in range(len(timestamps)):
        start = timestamps[i]
        if i + 1 < len(timestamps):
            end = timestamps[i + 1]
        else:
            end = start + max_length  # approximate

        if end - start > DEFAULT_OVERLONG_SPLIT:
            chunks = _split_range(start, end, DEFAULT_OVERLONG_SPLIT)
            for c_start, c_end in chunks:
                segments.append(Segment(seg_id, c_start, c_end))
                seg_id += 1
        else:
            segments.append(Segment(seg_id, start, end))
            seg_id += 1

    return segments
