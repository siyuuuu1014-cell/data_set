"""LocateAnything-3B grounding provider — real model inference.

Uses NVIDIA's LocateAnything-3B for open-vocabulary detection.
Requires: HF_TOKEN for gated model access.
Model format: <ref>category</ref><box><x1><y1><x2><y2></box><conf>0.92</conf>
Coordinates are 0-1000, must be scaled to image dimensions.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import torch
from PIL import Image

from config import LOCATE_ANYTHING_MODEL, DEVICE
from providers.registry import model_load_kwargs

logger = logging.getLogger(__name__)

# ── Regex patterns for parsing model output ──────────

_REF_PATTERN = re.compile(r"<ref>([^<]+)</ref>")
_BOX_PATTERN = re.compile(r"<box><(\d+)><(\d+)><(\d+)><(\d+)></box>")
_CONF_PATTERN = re.compile(r"<conf>([\d.]+)</conf>")
_TOKEN_PATTERN = re.compile(
    r"<ref>[^<]+</ref>|<box><\d+><\d+><\d+><\d+></box>|<conf>[\d.]+</conf>"
)


def parse_boxes(raw_text: str, img_w: int, img_h: int) -> list[dict]:
    """Parse model output into boxes with class names and confidence.

    Coordinates are 0-1000 normalized, scaled to actual image dimensions.
    Model output order: <ref>class</ref><box><x1><y1><x2><y2></box><conf>0.92</conf>
    """
    boxes: list[dict] = []
    current_class = ""
    pending_bbox: list[int] | None = None

    def _emit() -> None:
        nonlocal pending_bbox
        if current_class and pending_bbox:
            x1, y1, x2, y2 = pending_bbox
            boxes.append({
                "className": current_class,
                "bbox": [
                    int(x1 / 1000 * img_w),
                    int(y1 / 1000 * img_h),
                    int(x2 / 1000 * img_w),
                    int(y2 / 1000 * img_h),
                ],
                "confidence": None,  # filled by _set_conf below
            })

    def _set_conf(val: float | None) -> None:
        if boxes and boxes[-1].get("confidence") is None:
            boxes[-1]["confidence"] = val

    for token in _TOKEN_PATTERN.findall(raw_text):
        if token.startswith("<ref>"):
            # New category starts — emit any pending box
            _emit()
            pending_bbox = None
            m = _REF_PATTERN.match(token)
            if m:
                current_class = m.group(1).strip()
        elif token.startswith("<box>"):
            m = _BOX_PATTERN.match(token)
            if m and current_class:
                pending_bbox = list(map(int, m.groups()))
        elif token.startswith("<conf>"):
            _emit()  # bbox + class are ready, conf is the trigger
            pending_bbox = None
            m = _CONF_PATTERN.match(token)
            if m:
                try:
                    _set_conf(float(m.group(1)))
                except ValueError:
                    pass

    # Trailing ref+box without conf
    _emit()

    return boxes


class LocateAnythingGrounding:
    """Wrapper around LocateAnything-3B for fine-grained object detection.

    ~6GB VRAM at bf16. Cannot be loaded simultaneously with other models.
    """

    def __init__(self, model_path: str | None = None) -> None:
        self._model_path = model_path or LOCATE_ANYTHING_MODEL
        self._model: Any = None
        self._processor: Any = None
        self._tokenizer: Any = None
        self._loaded = False

    def load(self) -> None:
        # Don't pop HF_ENDPOINT — keep the user's configured mirror
        from transformers import AutoModel, AutoProcessor, AutoTokenizer

        logger.info("Loading LocateAnything-3B: %s", self._model_path)
        load_kwargs = model_load_kwargs("locate_anything", self._model_path)
        model_dtype = torch.bfloat16 if DEVICE == "cuda" else torch.float32

        try:
            self._tokenizer = AutoTokenizer.from_pretrained(
                self._model_path, trust_remote_code=True,
                local_files_only=False,  # allow download if not cached
                **load_kwargs,
            )
            self._processor = AutoProcessor.from_pretrained(
                self._model_path, trust_remote_code=True,
                local_files_only=False,
                **load_kwargs,
            )
            self._model = AutoModel.from_pretrained(
                self._model_path,
                torch_dtype=model_dtype,
                trust_remote_code=True,
                low_cpu_mem_usage=True,
                local_files_only=False,
                _attn_implementation="eager",  # bypass attn check for newer transformers
                **load_kwargs,
            )
        except OSError as e:
            raise RuntimeError(
                f"Failed to load LocateAnything-3B: {e}\n"
                f"Model files may be corrupted or missing in HuggingFace cache.\n"
                f"Try clearing the cache: rm -rf %HF_HOME%/hub/models--nvidia--LocateAnything-3B"
            ) from e
        if DEVICE == "cuda":
            self._model = self._model.to(DEVICE)
        self._model.eval()
        self._loaded = True
        logger.info("LocateAnything-3B loaded on %s", DEVICE)

    def unload(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
        if self._processor is not None:
            del self._processor
            self._processor = None
        if self._tokenizer is not None:
            del self._tokenizer
            self._tokenizer = None
        self._loaded = False
        if DEVICE == "cuda":
            import torch
            torch.cuda.empty_cache()
        logger.info("LocateAnything-3B unloaded")

    def detect_objects(self, image_path: str, categories: list[str]) -> list[dict]:
        """Detect objects of given categories.

        Returns [{ className, bbox: [x1,y1,x2,y2], confidence }]
        """
        if not self._loaded:
            raise RuntimeError("LocateAnything not loaded — call .load() first")

        img = Image.open(image_path).convert("RGB")
        try:
            orig_w, orig_h = img.size

            # Downscale large images to avoid GPU OOM
            max_side = 1280
            w, h = orig_w, orig_h
            longest = max(w, h)
            if longest > max_side:
                scale = max_side / longest
                w, h = int(w * scale), int(h * scale)
                img = img.resize((w, h), Image.LANCZOS)

            # Build prompt
            cats = ", ".join(categories)
            prompt = f"Locate all the instances that matches the following description: {cats}."

            messages = [{
                "role": "user",
                "content": [
                    {"type": "image", "image": img},
                    {"type": "text", "text": prompt},
                ],
            }]

            text = self._processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            images, videos = self._processor.process_vision_info(messages)
            inputs = self._processor(
                text=[text], images=images, videos=videos, return_tensors="pt"
            )
            inputs = {
                k: v.to(DEVICE) if hasattr(v, "to") else v
                for k, v in inputs.items()
            }

            with torch.inference_mode():
                response = self._model.generate(
                    pixel_values=inputs["pixel_values"].to(torch.bfloat16),
                    input_ids=inputs["input_ids"],
                    attention_mask=inputs["attention_mask"],
                    image_grid_hws=inputs.get("image_grid_hws"),
                    tokenizer=self._tokenizer,
                    max_new_tokens=512,
                    use_cache=True,
                    generation_mode="hybrid",
                    temperature=0.7,
                    do_sample=True,
                    top_p=0.9,
                    repetition_penalty=1.1,
                    verbose=False,
                )

            raw_text = response[0] if isinstance(response, tuple) else response
            boxes = parse_boxes(raw_text, orig_w, orig_h)

            logger.info(
                "LocateAnything: %d boxes detected for %d categories",
                len(boxes), len(categories),
            )
            return boxes
        finally:
            img.close()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
