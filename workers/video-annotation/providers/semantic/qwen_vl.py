"""Qwen3-VL-2B semantic annotation provider.

Qwen3-VL-2B ~4GB on disk, ~1.1GB VRAM at bf16.
Prompt tuned for small model — short, simple, avoids complex structured output.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import torch
from PIL import Image

from config import QWEN_MODEL, DEVICE
from providers.registry import model_load_kwargs

logger = logging.getLogger(__name__)

# Short prompt for 2B — natural language description, parse afterwards
PROMPT = """Describe this video frame. Answer in simple JSON with these keys only:
scene: what kind of place is this? (e.g. living room, street, office, classroom, outdoor garden)
lighting: bright or dim or dark?
indoor: true or false
camera_angle: eye-level or low or high or overhead?
persons: list of people seen. For each: gender, age (child/teen/young/middle/elderly), what they're doing, what they're wearing (color+type), hair color
objects: list of ANYTHING visible that is not a person — animals (dog, cat, butterfly, bird, insect), vehicles, furniture, instruments, electronics, plants, etc. For each: name, category, color, brand if visible
event: what is happening overall? (e.g. conversation, playing music, walking, eating, a butterfly resting, bird flying)

Example output:
{
  "scene": "garden",
  "lighting": "bright",
  "indoor": false,
  "camera_angle": "eye-level",
  "persons": [],
  "objects": [{"name":"butterfly","category":"animal","color":"orange"}],
  "event": "a butterfly is resting on a flower"
}
Return ONLY the JSON. No markdown, no explanation."""


def _parse_response(raw: str) -> dict:
    """Parse Qwen's JSON output into structured semantic fields."""
    import json_repair

    # Strip markdown code fences
    m = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw)
    text = m.group(1) if m else raw

    # Extract from first { to end (lazy — json_repair handles truncation)
    m = re.search(r'\{[\s\S]*', text)
    raw_json = m.group(0) if m else text

    # Try json_repair first — it can salvage truncated JSON
    # (json.loads alone fails on truncation but succeeds on a nested fragment,
    #  giving a false-positive empty parse)
    try:
        repaired = json_repair.repair_json(raw_json, return_objects=False)
        data = json.loads(repaired)
        if raw_json.strip() != repaired.strip():
            logger.info("Qwen3-VL JSON repaired (truncated)")
    except Exception:
        # json_repair failed; try straight parse (unlikely to help, but safe)
        try:
            data = json.loads(raw_json)
        except json.JSONDecodeError:
            logger.warning("Qwen3-VL JSON parse failed: %.300s", raw)
            return {}

    # --- Parse persons into attributes list ---
    persons_attrs: list[dict] = []
    for i, p in enumerate(data.get("persons") or [], start=1):
        person = {
            "trackId": i,
            # Identity is assigned by the video-scoped tracker. Semantic
            # attributes are not unique enough to identify a real person.
            "personId": None,
            "gender": _pick(p.get("gender"), ["male", "female"], "unknown"),
            "ageGroup": _pick(p.get("age"), ["child", "teen", "young adult", "middle aged", "elderly"], "unknown"),
            "expression": "unknown",
            "pose": "unknown",
            "action": [],
            "facing": "unknown",
            "hair": {"color": "unknown", "style": "unknown"},
            "clothing": [],
        }

        # Parse action
        action = p.get("action", "")
        if action:
            person["action"] = [a.strip() for a in str(action).split(",") if a.strip()]

        # Parse hair
        hair = p.get("hair", "")
        if hair:
            parts = str(hair).lower().split()
            hair_colors = ["black", "brown", "blonde", "gray", "white", "red"]
            hair_styles = ["short", "long", "curly", "straight", "bald", "tied"]
            for w in parts:
                if w in hair_colors:
                    person["hair"]["color"] = w
                if w in hair_styles:
                    person["hair"]["style"] = w

        # Parse clothing
        clothing = p.get("clothing", "")
        if clothing:
            for item in str(clothing).split(","):
                item = item.strip()
                if not item:
                    continue
                parts = item.lower().split()
                cloth_type = parts[-1] if len(parts) > 1 else item
                cloth_color = parts[0] if len(parts) > 1 and parts[0] in [
                    "black", "white", "red", "blue", "green", "yellow", "brown", "gray", "grey",
                    "pink", "orange", "purple", "dark", "light"
                ] else "unknown"
                person["clothing"].append({
                    "type": cloth_type,
                    "color": cloth_color,
                    "attributes": [],
                    "brand": None,
                })

        persons_attrs.append(person)

    # --- Parse objects ---
    objects_attrs: list[dict] = []
    for i, o in enumerate(data.get("objects") or [], start=len(persons_attrs) + 1):
        objects_attrs.append({
            "trackId": i + 100,  # offset to avoid collision with person trackIds
            "name": str(o.get("name", "")),
            "category": str(o.get("category", "other")),
            "color": str(o.get("color", "unknown")),
            "brand": o.get("brand") or None,
        })

    # --- Scene ---
    scene_type = str(data.get("scene", "unknown")).lower().replace(" ", "_")
    scene = {
        "tags": [data.get("scene", "")] if data.get("scene") else [],
        "place": {
            "type": scene_type if scene_type != "unknown" else "unknown",
            "indoor": data.get("indoor", True),
            "weather": None,
            "lighting": str(data.get("lighting", "unknown")),
            "timeOfDay": "unknown",
        },
    }

    # --- Camera ---
    angle = str(data.get("camera_angle", "unknown")).lower().replace(" ", "-")
    camera = {
        "shot": "unknown",
        "angle": angle,
        "movement": [],
        "lens": "unknown",
        "stabilization": "unknown",
    }

    # --- Events ---
    events: list[dict] = []
    event = data.get("event", "")
    if event:
        events.append({"type": str(event), "confidence": 0.7})

    return {
        "scene": scene,
        "camera": camera,
        "persons_attributes": persons_attrs,
        "objects_attributes": objects_attrs,
        "events": events,
    }


def _pick(value: str | None, options: list[str], default: str) -> str:
    if not value:
        return default
    v = str(value).lower().strip()
    for opt in options:
        if v == opt or v in opt or opt in v:
            return opt
    return default


def _extract_json(text: str) -> dict | None:
    m = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if m:
        text = m.group(1)
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


class QwenVLSemantic:
    """Qwen3-VL-2B for scene, camera, person/object attributes, and events."""

    def __init__(self, model_name: str | None = None) -> None:
        self._model_name = model_name or QWEN_MODEL
        self._model: Any = None
        self._processor: Any = None
        self._loaded = False

    def load(self) -> None:
        from transformers import Qwen3VLForConditionalGeneration, AutoProcessor

        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        logger.info("Loading Qwen3-VL-2B v2 (short prompt): %s", self._model_name)

        load_kwargs = model_load_kwargs("qwen_vl", self._model_name)
        model_dtype = torch.bfloat16 if DEVICE == "cuda" else torch.float32
        self._processor = AutoProcessor.from_pretrained(
            self._model_name, trust_remote_code=True, **load_kwargs
        )
        self._model = Qwen3VLForConditionalGeneration.from_pretrained(
            self._model_name,
            torch_dtype=model_dtype,
            trust_remote_code=True,
            **load_kwargs,
        )
        self._model.eval()
        if DEVICE in {"cuda", "mps"}:
            self._model = self._model.to(DEVICE)
        self._loaded = True
        logger.info("Qwen3-VL-2B loaded on %s", DEVICE)

    def unload(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
        if self._processor is not None:
            del self._processor
            self._processor = None
        self._loaded = False
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        logger.info("Qwen3-VL-2B unloaded")

    def annotate_semantic(
        self,
        video_path: str = "",
        frame_paths: list[str] | None = None,
        start: float = 0,
        end: float = 0,
        ontology: dict | None = None,
        prompt_template: str = "",
        examples: list[dict] | None = None,
    ) -> 'SegmentSemantic':
        from .base import SegmentSemantic

        if not self._loaded:
            self.load()

        if not frame_paths or len(frame_paths) == 0:
            return self._empty()

        image_path = frame_paths[0]
        try:
            img = Image.open(image_path).convert("RGB")
            logger.info("Qwen3-VL processing: %s (%dx%d)", image_path, img.width, img.height)

            messages = [
                {"role": "system", "content": PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": img},
                        {"type": "text", "text": "Describe this frame as JSON."},
                    ],
                },
            ]

            text = self._processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            inputs = self._processor(
                text=[text], images=[img], return_tensors="pt"
            )
            inputs = {k: v.to(DEVICE) for k, v in inputs.items()}

            with torch.inference_mode():
                generated = self._model.generate(
                    **inputs,
                    max_new_tokens=700,
                    temperature=0.3,
                    do_sample=False,
                    use_cache=True,
                )

            input_len = inputs["input_ids"].shape[1]
            output_ids = generated[0][input_len:]
            raw_text = self._processor.decode(output_ids, skip_special_tokens=True)
            logger.info("Qwen3-VL raw: %.400s", raw_text)

            parsed = _parse_response(raw_text)
            if not parsed:
                logger.warning("Qwen3-VL returned empty parse")
                return self._empty()

            return SegmentSemantic(
                scene=parsed.get("scene", {"tags": [], "place": {"type": "unknown", "indoor": True, "weather": None, "lighting": "unknown", "timeOfDay": "unknown"}}),
                camera=parsed.get("camera", {"shot": "unknown", "angle": "unknown", "movement": [], "lens": "unknown", "stabilization": "unknown"}),
                persons_attributes=parsed.get("persons_attributes", []),
                objects_attributes=parsed.get("objects_attributes", []),
                events=parsed.get("events", []),
            )
        except Exception as e:
            logger.warning("Qwen3-VL failed: %s (%s)", type(e).__name__, e)
            return self._empty()
        finally:
            if DEVICE == "cuda":
                torch.cuda.empty_cache()

    def _empty(self) -> 'SegmentSemantic':
        from .base import SegmentSemantic
        return SegmentSemantic(
            scene={"tags": [], "place": {"type": "unknown", "indoor": True, "weather": None, "lighting": "unknown", "timeOfDay": "unknown"}},
            camera={"shot": "unknown", "angle": "unknown", "movement": [], "lens": "unknown", "stabilization": "unknown"},
            persons_attributes=[],
            objects_attributes=[],
            events=[],
        )
