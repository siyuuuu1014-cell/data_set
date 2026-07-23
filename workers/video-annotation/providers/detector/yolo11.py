"""YOLO11 detection provider using Ultralytics."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np

from config import YOLO_MODEL, DEVICE, DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_IOU_THRESHOLD
from .base import DetectorProvider, FrameDetection

logger = logging.getLogger(__name__)

# Only keep YOLO classes relevant to video annotation — discard the rest as noise
YOLO_KEEP_CLASSES = {
    'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
    'chair', 'couch', 'dining table', 'bed', 'bench',
    'potted plant', 'book', 'backpack', 'handbag', 'suitcase',
    'sports ball', 'kite', 'skateboard', 'surfboard',
    'bottle', 'cup', 'bowl', 'knife', 'fork', 'spoon',
    'vase', 'clock', 'laptop', 'cell phone', 'keyboard',
    'tv', 'remote', 'tennis racket', 'baseball bat', 'baseball glove',
    'frisbee', 'snowboard', 'skis',
    'umbrella', 'tie',
    'dog', 'cat', 'horse', 'bird',
    'cake', 'pizza', 'sandwich', 'banana', 'apple', 'orange', 'donut',
    'toothbrush', 'hair drier', 'scissors', 'teddy bear',
    'sink', 'toilet', 'oven', 'microwave', 'refrigerator', 'toaster',
}

# Lazy imports — only import ultralytics when the provider is actually used
_yolo: Any = None


class YOLO11Detector:
    """YOLO11 detector for per-frame bounding box detection."""

    def __init__(self, model_name: str | None = None) -> None:
        self._model_name = model_name or YOLO_MODEL
        self._model: Any = None

    def load(self) -> None:
        global _yolo
        if _yolo is None:
            from ultralytics import YOLO
            _yolo = YOLO
        logger.info("Loading YOLO model: %s on %s", self._model_name, DEVICE)
        model_ref = self._model_name
        if Path(model_ref).suffix.lower() not in {".pt", ".yaml", ".yml", ".onnx"}:
            model_ref = f"{model_ref}.pt"
        self._model = _yolo(model_ref)
        if DEVICE in {"cuda", "mps"}:
            self._model.to(DEVICE)

    def unload(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
            if DEVICE == "cuda":
                import torch
                torch.cuda.empty_cache()
        logger.info("YOLO model unloaded")

    def detect_frames(
        self,
        frames: list[np.ndarray],
        conf: float | None = None,
        iou: float = 0.45,
    ) -> list[FrameDetection]:
        if self._model is None:
            raise RuntimeError("YOLO model not loaded — call .load() first")

        conf = conf or DEFAULT_CONFIDENCE_THRESHOLD
        iou = iou if iou != 0.45 else DEFAULT_IOU_THRESHOLD
        results: list[FrameDetection] = []

        for i, frame in enumerate(frames):
            # Convert RGB if needed
            if frame.ndim == 3 and frame.shape[2] == 3:
                frame_rgb = frame[..., ::-1]  # BGR → RGB
            else:
                frame_rgb = frame

            preds = self._model(frame_rgb, conf=conf, iou=iou, verbose=False)

            detections: list[dict] = []
            if preds and len(preds) > 0:
                p = preds[0]
                boxes = p.boxes
                if boxes is not None:
                    for j in range(len(boxes)):
                        xyxy = boxes.xyxy[j].tolist()
                        cls_id = int(boxes.cls[j].item())
                        cls_name = self._model.names.get(cls_id, str(cls_id))
                        # Filter: only keep classes relevant to video annotation
                        if cls_name not in YOLO_KEEP_CLASSES:
                            continue
                        detections.append({
                            "bbox": [
                                xyxy[0],
                                xyxy[1],
                                xyxy[2] - xyxy[0],
                                xyxy[3] - xyxy[1],
                            ],
                            "className": cls_name,
                            "confidence": float(boxes.conf[j].item()),
                        })

            results.append(FrameDetection(frame_index=i, detections=detections))

        return results
