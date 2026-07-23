"""Grounding provider base protocol — fine-grained object detection."""

from __future__ import annotations

from typing import Protocol


class GroundingProvider(Protocol):
    """Interface for open-vocabulary / fine-grained object detection."""

    def load(self) -> None:
        ...

    def unload(self) -> None:
        ...

    def detect_objects(
        self,
        image_path: str,
        categories: list[str],
    ) -> list[dict]:
        """Detect objects of given categories in image.
        
        Returns: [{ className, bbox: [x1,y1,x2,y2], confidence }]
        """
        ...
