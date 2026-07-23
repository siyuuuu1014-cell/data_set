"""Depth Anything v2 provider — real monocular depth estimation."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import torch
from PIL import Image

from config import DEPTH_ANYTHING_MODEL, DEVICE
from providers.registry import model_load_kwargs
from .base import DepthResult

logger = logging.getLogger(__name__)

FOCAL_LENGTH_PX = 800.0  # rough estimate, refined per-video via metadata


class DepthAnythingEstimator:
    """Depth Anything v2 Small monocular depth estimator.

    Uses HuggingFace: depth-anything/Depth-Anything-V2-Small-hf (~1GB VRAM).
    """

    def __init__(self, model_name: str | None = None) -> None:
        self._model_name = model_name or DEPTH_ANYTHING_MODEL
        self._model: Any = None
        self._processor: Any = None

    def load(self) -> None:
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation

        logger.info("Loading Depth Anything v2: %s", self._model_name)
        load_kwargs = model_load_kwargs("depth_anything", self._model_name)
        self._processor = AutoImageProcessor.from_pretrained(
            self._model_name, **load_kwargs
        )
        self._model = AutoModelForDepthEstimation.from_pretrained(
            self._model_name, **load_kwargs
        )
        if DEVICE in {"cuda", "mps"}:
            self._model = self._model.to(DEVICE)
        self._model.eval()
        logger.info("Depth Anything v2 loaded on %s", DEVICE)

    def unload(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
        if self._processor is not None:
            del self._processor
            self._processor = None
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        logger.info("Depth Anything v2 unloaded")

    def estimate_depth(
        self,
        image_path: str,
        bboxes: list[dict],
        focal_length_px: float = FOCAL_LENGTH_PX,
    ) -> DepthResult:
        if self._model is None:
            raise RuntimeError("Depth Anything v2 not loaded — call .load() first")

        image = Image.open(image_path).convert("RGB")
        img_w, img_h = image.size

        inputs = self._processor(images=image, return_tensors="pt")
        if DEVICE == "cuda":
            inputs = {k: v.to("cuda") for k, v in inputs.items()}

        with torch.no_grad():
            outputs = self._model(**inputs)
            pred = outputs.predicted_depth

        # Resize depth map to original image size
        pred = torch.nn.functional.interpolate(
            pred.unsqueeze(1),
            size=(img_h, img_w),
            mode="bicubic",
            align_corners=False,
        ).squeeze()

        depth_map = pred.cpu().numpy()

        # Normalize to 0-1 relative range (model outputs relative depth, not metric meters)
        dmin, dmax = depth_map.min(), depth_map.max()
        depth_range = dmax - dmin
        if depth_range > 0:
            depth_map = (depth_map - dmin) / depth_range

        # Per-object depth: median of bbox region (0-1 relative)
        objects_depths: list[dict] = []
        for b in bboxes:
            bx, by, bw, bh = b["bbox"]
            x1 = max(0, int(bx))
            y1 = max(0, int(by))
            x2 = min(img_w, int(bx + bw))
            y2 = min(img_h, int(by + bh))

            if x2 <= x1 or y2 <= y1:
                objects_depths.append({"trackId": b.get("trackId", -1), "depth": 0.5})
                continue

            roi = depth_map[y1:y2, x1:x2]
            depth_val = float(np.median(roi))

            objects_depths.append({
                "trackId": b.get("trackId", -1),
                "depth": round(depth_val, 2),
            })

        mean_depth = float(np.mean(depth_map))

        return DepthResult(
            depth_map=depth_map,
            mean_depth_meters=round(mean_depth, 1),
            objects_depths=objects_depths,
        )
