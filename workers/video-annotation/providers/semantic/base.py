"""Semantic provider base protocol — VL understanding for attributes."""

from __future__ import annotations

from typing import Protocol


class SegmentSemantic:
    """Structured semantic result for one video segment."""

    def __init__(
        self,
        scene: dict,
        camera: dict,
        persons_attributes: list[dict],
        objects_attributes: list[dict],
        events: list[dict],
    ) -> None:
        self.scene = scene
        self.camera = camera
        self.persons_attributes = persons_attributes
        self.objects_attributes = objects_attributes
        self.events = events


class SemanticProvider(Protocol):
    """Interface for semantic annotation providers."""

    def load(self) -> None:
        ...

    def unload(self) -> None:
        ...

    def annotate_semantic(
        self,
        video_path: str,
        frame_paths: list[str],
        start: float,
        end: float,
        ontology: dict,
        prompt_template: str,
        examples: list[dict],
    ) -> SegmentSemantic:
        """Generate structured semantic attributes for a segment."""
        ...
