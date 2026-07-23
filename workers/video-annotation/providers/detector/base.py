"""Detector provider base protocol."""

from __future__ import annotations

from typing import Protocol

import numpy as np


class FrameDetection:
    """Detection result for a single frame."""
    def __init__(self, frame_index: int, detections: list[dict]) -> None:
        self.frame_index = frame_index
        self.detections = detections  # [{ bbox: [x,y,w,h], className, confidence }]


class DetectorProvider(Protocol):
    """Interface for object detection providers."""

    def load(self) -> None:
        """Load model into memory."""
        ...

    def unload(self) -> None:
        """Unload model to free GPU memory."""
        ...

    def detect_frames(self, frames: list[np.ndarray]) -> list[FrameDetection]:
        """Run detection on a list of frame images. Returns per-frame detections."""
        ...
