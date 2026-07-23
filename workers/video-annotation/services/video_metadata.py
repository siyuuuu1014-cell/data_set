"""FFprobe wrapper — reads video metadata."""

from __future__ import annotations

import json
import logging
import subprocess

from config import FFPROBE_PATH

logger = logging.getLogger(__name__)


class VideoMetadata:
    def __init__(
        self,
        duration: float,
        fps: float,
        width: int,
        height: int,
        codec: str = "",
        bitrate: int = 0,
        has_audio: bool = False,
    ) -> None:
        self.duration = duration
        self.fps = fps
        self.width = width
        self.height = height
        self.codec = codec
        self.bitrate = bitrate
        self.has_audio = has_audio


def get_video_metadata(filepath: str) -> VideoMetadata:
    """Extract metadata from a video file using ffprobe."""
    cmd = [
        FFPROBE_PATH, "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        filepath,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=30)
        if result.returncode != 0:
            raise RuntimeError(f"ffprobe failed: {result.stderr}")

        data = json.loads(result.stdout)
        fmt = data.get("format", {})
        streams = data.get("streams", [])

        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        if video_stream is None:
            raise RuntimeError("No video stream found")

        # Parse fps — may be a fraction like "30000/1001"
        fps_str = video_stream.get("avg_frame_rate", "0/1")
        num, den = fps_str.split("/") if "/" in fps_str else (fps_str, "1")
        fps = float(num) / float(den) if float(den) != 0 else 0.0

        duration = float(fmt.get("duration", 0)) or float(video_stream.get("duration", 0))

        return VideoMetadata(
            duration=duration,
            fps=fps,
            width=int(video_stream.get("width", 0)),
            height=int(video_stream.get("height", 0)),
            codec=video_stream.get("codec_name", ""),
            bitrate=int(fmt.get("bit_rate", 0)),
            has_audio=audio_stream is not None,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffprobe timed out")
