"""Tracker provider base protocol."""

from __future__ import annotations

from typing import Protocol

from providers.detector.base import FrameDetection


class FrameTrack:
    """Tracking result for a single frame."""
    def __init__(self, frame_index: int, tracks: list[dict]) -> None:
        self.frame_index = frame_index
        # tracks: [{ trackId, className, bbox, detectionConfidence, trackingConfidence }]
        self.tracks = tracks


class TrackerProvider(Protocol):
    """Interface for multi-object tracking providers."""

    def load(self) -> None:
        ...

    def unload(self) -> None:
        ...

    def track(
        self,
        detections: list[FrameDetection],
        segment_id: str,
    ) -> list[FrameTrack]:
        """Associate detections across frames, producing Track IDs."""
        ...
