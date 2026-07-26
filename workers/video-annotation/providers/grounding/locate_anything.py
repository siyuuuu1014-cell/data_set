"""LocateAnything-3B grounding provider — real model inference.

Uses NVIDIA's LocateAnything-3B for open-vocabulary detection.
Requires: HF_TOKEN for gated model access.
Model format: <ref>category</ref><box><x1><y1><x2><y2></box><conf>0.92</conf>
Coordinates are 0-1000, must be scaled to image dimensions.
"""

from __future__ import annotations

import importlib
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import torch
from PIL import Image

from config import (
    DEVICE,
    LOCATE_ANYTHING_MODEL,
    LOCATE_GENERATION_MODE,
    LOCATE_MAX_NEW_TOKENS,
    LOCATE_MAX_SIDE,
)
from providers.registry import model_load_kwargs

logger = logging.getLogger(__name__)
LOCATE_ATTN_IMPLEMENTATION = "sdpa"
_BATCH_ENV_KEYS = (
    "LA_FLASH_MODEL",
    "LA_FLASH_ATTN",
    "LA_FLASH_VISION_ATTN",
)

# ── Regex patterns for parsing model output ──────────

_REF_PATTERN = re.compile(r"<ref>([^<]+)</ref>")
_BOX_PATTERN = re.compile(r"<box><(\d+)><(\d+)><(\d+)><(\d+)></box>")
_CONF_PATTERN = re.compile(r"<conf>([\d.]+)</conf>")
_TOKEN_PATTERN = re.compile(
    r"<ref>[^<]+</ref>|<box><\d+><\d+><\d+><\d+></box>|<conf>[\d.]+</conf>"
)


def _category_query(categories: list[str]) -> str:
    """Use LocateAnything's category separator from the official worker."""
    return "</c>".join(
        category.strip()
        for category in categories
        if isinstance(category, str) and category.strip()
    )


def _resize_for_inference(img: Image.Image, max_side: int) -> Image.Image:
    """Bound visual tokens while preserving the source aspect ratio."""
    width, height = img.size
    longest = max(width, height)
    if longest <= max_side:
        return img
    scale = max_side / longest
    return img.resize(
        (max(1, int(width * scale)), max(1, int(height * scale))),
        Image.LANCZOS,
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
        self._batch_utils: Any = None
        self._batch_runtime: Any = None
        self._batch_root: str | None = None
        self._batch_env: dict[str, str | None] = {}
        self._loaded = False

    def _load_official_batch_runtime(self) -> bool:
        """Use the model release's optimized hybrid executor when available."""
        if DEVICE != "cuda" or LOCATE_GENERATION_MODE != "hybrid":
            return False
        model_root = Path(self._model_path).expanduser()
        if not (
            model_root.is_dir()
            and (model_root / "batch_utils" / "__init__.py").is_file()
        ):
            return False

        self._batch_env = {
            key: os.environ.get(key)
            for key in _BATCH_ENV_KEYS
        }
        os.environ["LA_FLASH_MODEL"] = str(model_root)
        os.environ["LA_FLASH_ATTN"] = LOCATE_ATTN_IMPLEMENTATION
        os.environ["LA_FLASH_VISION_ATTN"] = "sdpa"

        self._batch_root = str(model_root)
        if self._batch_root not in sys.path:
            sys.path.insert(0, self._batch_root)

        batch_utils = importlib.import_module("batch_utils")
        batch_runtime = importlib.import_module("batch_utils.hybrid_runtime")
        self._batch_utils = batch_utils
        self._batch_runtime = batch_runtime
        tokenizer, processor, model = batch_utils.load()
        self._tokenizer = tokenizer
        self._processor = processor
        self._model = model
        logger.info("LocateAnything: using official optimized hybrid executor")
        return True

    def _restore_batch_environment(self) -> None:
        for key, previous in self._batch_env.items():
            if previous is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = previous
        self._batch_env = {}

    def _release_batch_runtime(self) -> None:
        runtime = self._batch_runtime
        if runtime is not None:
            # The official helper keeps its model in module globals. Clear those
            # references so later providers can use this 8GB GPU.
            runtime._model = None
            runtime._proc = None
            runtime._tok = None
        self._batch_utils = None
        self._batch_runtime = None
        if self._batch_root in sys.path:
            sys.path.remove(self._batch_root)
        self._batch_root = None
        self._restore_batch_environment()

    def load(self) -> None:
        # Don't pop HF_ENDPOINT — keep the user's configured mirror
        from transformers import AutoModel, AutoProcessor, AutoTokenizer

        started_at = time.perf_counter()
        logger.info("Loading LocateAnything-3B: %s", self._model_path)
        load_kwargs = model_load_kwargs("locate_anything", self._model_path)
        model_dtype = torch.bfloat16 if DEVICE == "cuda" else torch.float32

        try:
            optimized = self._load_official_batch_runtime()
            if not optimized:
                self._tokenizer = AutoTokenizer.from_pretrained(
                    self._model_path, trust_remote_code=True,
                    **load_kwargs,
                )
                self._processor = AutoProcessor.from_pretrained(
                    self._model_path, trust_remote_code=True,
                    **load_kwargs,
                )
                self._model = AutoModel.from_pretrained(
                    self._model_path,
                    torch_dtype=model_dtype,
                    trust_remote_code=True,
                    low_cpu_mem_usage=True,
                    # LocateAnything's remote Qwen2 implementation supports Magi
                    # Attention or PyTorch SDPA. "eager" reaches an explicit
                    # NotImplementedError during generation.
                    attn_implementation=LOCATE_ATTN_IMPLEMENTATION,
                    **load_kwargs,
                )
        except OSError as e:
            self._release_batch_runtime()
            raise RuntimeError(
                f"Failed to load LocateAnything-3B: {e}\n"
                f"Model files may be corrupted or missing in HuggingFace cache.\n"
                f"Try clearing the cache: rm -rf %HF_HOME%/hub/models--nvidia--LocateAnything-3B"
            ) from e
        except Exception:
            self._release_batch_runtime()
            raise
        if DEVICE == "cuda" and self._batch_utils is None:
            self._model = self._model.to(DEVICE)
        self._model.eval()
        self._loaded = True
        logger.info(
            "LocateAnything-3B loaded on %s in %.2fs",
            DEVICE,
            time.perf_counter() - started_at,
        )

    def unload(self) -> None:
        self._model = None
        self._processor = None
        self._tokenizer = None
        self._release_batch_runtime()
        self._loaded = False
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        logger.info("LocateAnything-3B unloaded")

    def detect_objects(
        self,
        image_path: str,
        categories: list[str],
        generation_mode: str | None = None,
        max_new_tokens: int | None = None,
    ) -> list[dict]:
        """Detect objects of given categories.

        Returns [{ className, bbox: [x1,y1,x2,y2], confidence }]
        """
        if not self._loaded:
            raise RuntimeError("LocateAnything not loaded — call .load() first")

        mode = generation_mode or LOCATE_GENERATION_MODE
        if mode not in {"hybrid", "fast", "slow"}:
            raise ValueError(f"Unsupported LocateAnything generation mode: {mode}")
        token_budget = max_new_tokens or LOCATE_MAX_NEW_TOKENS

        with Image.open(image_path) as source:
            img = source.convert("RGB")
        try:
            orig_w, orig_h = img.size
            resized = _resize_for_inference(img, LOCATE_MAX_SIDE)
            if resized is not img:
                img.close()
                img = resized

            query = _category_query(categories)
            if not query:
                return []

            if DEVICE == "cuda":
                torch.cuda.synchronize()
            inference_started_at = time.perf_counter()

            if self._batch_utils is not None and mode == "hybrid":
                raw_text = self._batch_utils.generate_batch_hybrid(
                    [(img, query)],
                    temperature=0.7,
                    top_p=0.9,
                    repetition_penalty=1.1,
                    max_new_tokens=token_budget,
                )[0]
            else:
                prompt = (
                    "Locate all the instances that matches the following "
                    f"description: {query}."
                )
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
                model_dtype = (
                    torch.bfloat16 if DEVICE == "cuda" else torch.float32
                )

                with torch.inference_mode():
                    response = self._model.generate(
                        pixel_values=inputs["pixel_values"].to(model_dtype),
                        input_ids=inputs["input_ids"],
                        attention_mask=inputs["attention_mask"],
                        image_grid_hws=inputs.get("image_grid_hws"),
                        tokenizer=self._tokenizer,
                        max_new_tokens=token_budget,
                        use_cache=True,
                        generation_mode=mode,
                        temperature=0.7,
                        do_sample=True,
                        top_p=0.9,
                        repetition_penalty=1.1,
                        verbose=False,
                    )
                raw_text = response[0] if isinstance(response, tuple) else response

            if DEVICE == "cuda":
                torch.cuda.synchronize()
            inference_seconds = time.perf_counter() - inference_started_at
            boxes = parse_boxes(raw_text, orig_w, orig_h)

            logger.info(
                "LocateAnything: %d boxes for %d categories in %.2fs "
                "(input=%dx%d, mode=%s, executor=%s)",
                len(boxes), len(categories),
                inference_seconds,
                img.width, img.height,
                mode,
                (
                    "official_batch"
                    if self._batch_utils is not None and mode == "hybrid"
                    else "stock"
                ),
            )
            return boxes
        finally:
            img.close()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
