"""Frame extraction — decode video frames at specified FPS."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from config import FFMPEG_PATH

logger = logging.getLogger(__name__)


def extract_frames(
    video_path: str,
    start: float,
    end: float,
    fps: float = 0.5,
    output_dir: str | None = None,
) -> list[str]:
    """Extract frames from a video segment at given FPS."""
    created_output_dir = output_dir is None
    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="frames_")

    os.makedirs(output_dir, exist_ok=True)
    out_pattern = os.path.join(output_dir, "frame_%04d.jpg")

    duration = end - start
    cmd = [
        FFMPEG_PATH,
        "-ss", str(start),
        "-t", str(duration),
        "-i", video_path,
        "-vf", f"fps={fps}",
        "-q:v", "2",
        "-vsync", "vfr",
        out_pattern,
        "-y",
    ]

    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=120, encoding="utf-8")
    except subprocess.CalledProcessError as e:
        stderr = e.stderr
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        detail = str(stderr or "unknown ffmpeg error")[:500]
        logger.error("ffmpeg frame extraction failed: %s", detail)
        if created_output_dir:
            shutil.rmtree(output_dir, ignore_errors=True)
        raise RuntimeError(f"Frame extraction failed: {detail}") from e

    frames = sorted(Path(output_dir).glob("frame_*.jpg"))
    return [str(f) for f in frames]


def load_frame_as_array(image_path: str) -> np.ndarray:
    img = Image.open(image_path).convert("RGB")
    return np.array(img)


def load_frames(image_paths: list[str]) -> list[np.ndarray]:
    return [load_frame_as_array(p) for p in image_paths]


def extract_keyframe(
    video_path: str,
    timestamp: float,
    output_dir: str | None = None,
    duration: float = 0.0,
) -> str:
    """Extract a single keyframe at a specific timestamp.

    Clamps timestamp < duration. Falls back to mid-frame on failure.
    """
    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="keyframe_")

    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, f"keyframe_{timestamp:.1f}.jpg")

    # Clamp: must be >= 0 and strictly < duration
    if duration > 0:
        t = max(0.0, min(timestamp, duration - 0.1))
    else:
        t = timestamp

    cmd = [
        FFMPEG_PATH,
        "-ss", str(t),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        out_path,
        "-y",
    ]
    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=30, encoding="utf-8")
    except subprocess.CalledProcessError:
        if duration > 0:
            mid = duration / 2
            cmd[1] = str(mid)
            subprocess.run(cmd, capture_output=True, check=True, timeout=30, encoding="utf-8")
        else:
            raise
    return out_path


def extract_segment_keyframes(
    video_path: str,
    start: float,
    end: float,
    num_keyframes: int = 3,
    output_dir: str | None = None,
    duration: float = 0.0,
) -> list[str]:
    """Extract evenly-spaced keyframes across a segment."""
    if num_keyframes < 1:
        num_keyframes = 1

    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="keyframes_")

    paths: list[str] = []
    for i in range(num_keyframes):
        t = start + (end - start) * (i / max(num_keyframes - 1, 1))
        kf_path = extract_keyframe(video_path, t, output_dir, duration=duration)
        paths.append(kf_path)

    return paths
