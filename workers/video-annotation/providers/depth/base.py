"""Depth estimation provider base protocol."""

from __future__ import annotations

from typing import Protocol

import numpy as np


class DepthResult:
    """Depth estimation output."""

    def __init__(
        self,
        depth_map: np.ndarray,
        mean_depth_meters: float,
        objects_depths: list[dict],
    ) -> None:
        self.depth_map = depth_map
        self.mean_depth_meters = mean_depth_meters
        # objects_depths: [{ trackId, depth }]
        self.objects_depths = objects_depths


class DepthProvider(Protocol):
    """Interface for monocular depth estimation providers."""

    def load(self) -> None:
        ...

    def unload(self) -> None:
        ...

    def estimate_depth(
        self,
        image_path: str,
        bboxes: list[dict],
    ) -> DepthResult:
        """Estimate depth map and per-object depth/height."""
        ...
