"""Chinese/English scene-text OCR backed by RapidOCR.

The provider class and registry id retain their historical ``TrOCR`` names so
existing environment variables and saved provider selections remain valid.
Unlike the previous single-line TrOCR implementation, RapidOCR performs text
detection, line orientation, and recognition on the complete keyframe.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class TrOCRProvider:
    """Detect and recognize Chinese/English text in complete keyframes."""

    def __init__(self, model_name: str | None = None) -> None:
        # ``model_name`` is accepted for backward compatibility with callers
        # that constructed the old provider directly. RapidOCR ships its small
        # ONNX detection/recognition models with the Python package.
        self._legacy_model_name = model_name
        self._engine: Any = None
        self._loaded = False

    def load(self) -> None:
        from rapidocr import RapidOCR

        logger.info("Loading RapidOCR scene-text detector and recognizer")
        self._engine = RapidOCR(params={"Global.log_level": "warning"})
        self._loaded = True
        logger.info("RapidOCR loaded (ONNX Runtime CPU)")

    def unload(self) -> None:
        self._engine = None
        self._loaded = False
        logger.info("RapidOCR unloaded")

    def extract_text(self, image_path: str) -> list[dict]:
        """Return detected text lines with pixel bboxes and real OCR scores.

        Provider failures are intentionally raised to the pipeline so the UI
        can distinguish an OCR failure from a successful run with no text.
        """
        if not self._loaded:
            self.load()

        try:
            result = self._engine(
                image_path,
                use_det=True,
                use_cls=True,
                use_rec=True,
            )
        except Exception as error:
            raise RuntimeError(f"RapidOCR inference failed: {error}") from error

        if result is None:
            return []

        texts = tuple(getattr(result, "txts", None) or ())
        scores = tuple(getattr(result, "scores", None) or ())
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            boxes = ()

        recognized: list[dict] = []
        for index, raw_text in enumerate(texts):
            text = str(raw_text).strip()
            if not text:
                continue

            bbox = _polygon_to_bbox(boxes[index]) if index < len(boxes) else None
            score = float(scores[index]) if index < len(scores) else None
            recognized.append({
                "text": text,
                "bbox": bbox,
                "confidence": score,
            })

        logger.info("RapidOCR detected %d text lines", len(recognized))
        return recognized


def _polygon_to_bbox(points: Any) -> dict[str, int] | None:
    """Convert a four-point OCR polygon into the existing x/y/w/h schema."""
    try:
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
    except (TypeError, ValueError, IndexError):
        return None
    if not xs or not ys:
        return None

    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    return {
        "x": max(0, round(x1)),
        "y": max(0, round(y1)),
        "width": max(1, round(x2 - x1)),
        "height": max(1, round(y2 - y1)),
    }
