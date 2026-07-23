"""TrOCR provider — text recognition in video keyframes.

TrOCR small-printed: ~300MB disk, <1GB VRAM at inference.
Loads image processor and tokenizer manually to avoid TrOCRProcessor bugs.
"""

from __future__ import annotations

import logging
from typing import Any

import torch
from PIL import Image

from config import DEVICE, TROCR_MODEL
from providers.registry import model_load_kwargs

logger = logging.getLogger(__name__)

class TrOCRProvider:
    """Extract text from keyframe images."""

    def __init__(self, model_name: str | None = None) -> None:
        self._model_name = model_name or TROCR_MODEL
        self._image_processor: Any = None
        self._tokenizer: Any = None
        self._model: Any = None
        self._loaded = False

    def load(self) -> None:
        from transformers import (
            VisionEncoderDecoderModel,
            ViTImageProcessor,
            AutoTokenizer,
        )

        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        from transformers import logging as trf_logging
        trf_logging.set_verbosity_warning()
        logger.info("Loading TrOCR: %s", self._model_name)
        load_kwargs = model_load_kwargs("trocr", self._model_name)

        self._model = VisionEncoderDecoderModel.from_pretrained(
            self._model_name, ignore_mismatched_sizes=True, **load_kwargs
        )
        self._model.eval()

        # Load sub-components individually (avoids TrOCRProcessor tokenizer bug)
        self._image_processor = ViTImageProcessor.from_pretrained(
            self._model_name, **load_kwargs
        )
        self._tokenizer = AutoTokenizer.from_pretrained(
            self._model_name, **load_kwargs
        )

        if DEVICE == "cuda":
            self._model = self._model.to(DEVICE)
        self._loaded = True
        logger.info("TrOCR loaded on %s", DEVICE)

    def unload(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
        if self._image_processor is not None:
            del self._image_processor
            self._image_processor = None
        if self._tokenizer is not None:
            del self._tokenizer
            self._tokenizer = None
        self._loaded = False
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        logger.info("TrOCR unloaded")

    def extract_text(self, image_path: str) -> list[dict]:
        """Extract text from a keyframe image."""
        if not self._loaded:
            self.load()

        try:
            img = Image.open(image_path).convert("RGB")
            logger.info("TrOCR processing: %s (%dx%d)", image_path, img.width, img.height)

            pixel_values = self._image_processor(img, return_tensors="pt").pixel_values
            if DEVICE == "cuda":
                pixel_values = pixel_values.to(DEVICE)

            with torch.inference_mode():
                generated_ids = self._model.generate(
                    pixel_values,
                    max_length=128,
                    num_beams=4,
                    early_stopping=True,
                )

            text = self._tokenizer.batch_decode(
                generated_ids, skip_special_tokens=True
            )[0].strip()

            if not text:
                return []

            logger.info("TrOCR detected: %.200s", text)
            return [
                {
                    "text": text,
                    "bbox": {"x": 0, "y": 0, "width": img.width, "height": img.height},
                    "confidence": 0.85,
                }
            ]
        except Exception as e:
            logger.warning("TrOCR failed: %s (%s)", type(e).__name__, e)
            return []
        finally:
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
