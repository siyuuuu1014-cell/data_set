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
from providers.registry import model_load_kwargs, resolve_model_reference

logger = logging.getLogger(__name__)

# Short prompt for 2B — natural language description, parse afterwards
PROMPT = """Describe only what is clearly visible in this video frame.
Return one simple JSON object with exactly these keys:
scene: the visible place type, or "unknown"
lighting: "bright", "dim", "dark", or "unknown"
indoor: true or false
camera_angle: "eye-level", "low", "high", "overhead", or "unknown"
event_type: one event label for the main visible activity
event_description: one short sentence summarizing what is visibly happening
persons: a list of clearly visible people; for each include gender, age, action, clothing, and hair
objects: a list of clearly visible non-person objects; for each include name, category, color, and brand

Rules:
- Never guess an object, person, action, or event that is not visually supported.
- If an object is uncertain or too small to identify, omit it from objects.
- Use an empty list when no person or object is clearly visible.
- Use "unknown" for an uncertain attribute instead of inventing a value.
- For event_type, return exactly one of: music_performance, sports_activity,
  dance_performance, conversation, argument, celebration, ceremony, cooking,
  eating, cleaning, repairing, shopping, commuting, exercising, playing,
  studying, working, accident, emergency; otherwise return visual_activity.
- event_description must describe only visible people, actions, and objects.
  Never copy speech or infer an event from dialogue alone. If something is
  visible, event_description must not be empty.
- Do not copy entities or activities from these instructions.

Return ONLY JSON. No markdown and no explanation."""

EVENT_TYPES = {
    "music_performance", "sports_activity", "dance_performance",
    "conversation", "argument", "celebration", "ceremony",
    "cooking", "eating", "cleaning", "repairing",
    "shopping", "commuting", "exercising", "playing",
    "studying", "working", "accident", "emergency",
    "visual_activity",
}

_EVENT_ALIASES = {
    "music performance": "music_performance",
    "sports activity": "sports_activity",
    "dance performance": "dance_performance",
}

_EVENT_KEYWORDS = (
    ("music_performance", ("singing", "playing guitar", "playing piano", "music performance")),
    ("sports_activity", ("playing football", "playing basketball", "playing soccer", "playing tennis")),
    ("dance_performance", ("dancing", "dance performance")),
    ("conversation", ("conversation", "talking to", "speaking to", "chatting", "discussion")),
    ("argument", ("argument", "arguing", "quarreling")),
    ("celebration", ("celebrating", "celebration")),
    ("cooking", ("cooking", "preparing food")),
    ("eating", ("eating", "having a meal")),
    ("cleaning", ("cleaning",)),
    ("repairing", ("repairing", "fixing")),
    ("shopping", ("shopping",)),
    ("commuting", ("commuting",)),
    ("exercising", ("exercising", "working out")),
    ("studying", ("studying",)),
    ("working", ("working",)),
    ("accident", ("accident", "collision", "crash")),
    ("emergency", ("emergency",)),
)

_EVENT_DEFAULT_DESCRIPTIONS = {
    "music_performance": "A person is visibly performing music.",
    "sports_activity": "People are visibly taking part in a sports activity.",
    "dance_performance": "A person is visibly dancing.",
    "conversation": "Multiple people are visibly talking with each other.",
    "argument": "People are visibly arguing.",
    "celebration": "People are visibly celebrating.",
    "ceremony": "People are visibly taking part in a ceremony.",
    "cooking": "A person is visibly preparing food.",
    "eating": "A person is visibly eating.",
    "cleaning": "A person is visibly cleaning.",
    "repairing": "A person is visibly repairing something.",
    "shopping": "A person is visibly shopping.",
    "commuting": "People are visibly commuting.",
    "exercising": "A person is visibly exercising.",
    "playing": "A person is visibly playing.",
    "studying": "A person is visibly studying.",
    "working": "A person is visibly working.",
    "accident": "An accident is visibly occurring.",
    "emergency": "An emergency situation is visibly occurring.",
    "visual_activity": "The frame shows visible people, objects, or activity.",
}


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

    semantic_keys = {
        "scene", "lighting", "indoor", "camera_angle",
        "persons", "objects", "event", "event_type", "event_description",
    }
    if not isinstance(data, dict) or not semantic_keys.intersection(data):
        logger.warning("Qwen3-VL JSON contained no semantic fields: %.300s", raw)
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
            "ageGroup": _pick(
                p.get("age"),
                ["child", "teen", "young adult", "middle aged", "elderly"],
                "unknown",
                aliases={"young": "young adult", "middle": "middle aged"},
            ),
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
    raw_description = data.get("event_description", data.get("event", ""))
    event = _normalize_event(data.get("event_type", raw_description))
    if not event and str(raw_description or "").strip():
        event = "visual_activity"
    if event:
        events.append({
            "type": event,
            "description": _event_description(raw_description, event),
            "confidence": 0.7,
        })
    else:
        derived_event = _derive_event_from_person_actions(persons_attrs)
        if derived_event:
            events.append({
                "type": derived_event,
                "description": _EVENT_DEFAULT_DESCRIPTIONS[derived_event],
                "confidence": 0.65,
            })

    return {
        "scene": scene,
        "camera": camera,
        "persons_attributes": persons_attrs,
        "objects_attributes": objects_attrs,
        "events": events,
    }


def _normalize_event(value: object) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").lower()).strip(" .")
    if not normalized:
        return ""
    ontology_value = normalized.replace("-", "_").replace(" ", "_")
    if ontology_value in EVENT_TYPES:
        return ontology_value
    if normalized in _EVENT_ALIASES:
        return _EVENT_ALIASES[normalized]
    for event_type, keywords in _EVENT_KEYWORDS:
        if any(keyword in normalized for keyword in keywords):
            return event_type
    return ""


def _event_description(value: object, event_type: str) -> str:
    description = re.sub(r"\s+", " ", str(value or "")).strip()
    normalized = description.lower().strip(" .").replace("-", "_").replace(" ", "_")
    if not description or normalized == event_type:
        return _EVENT_DEFAULT_DESCRIPTIONS[event_type]
    if len(description) > 200:
        description = description[:197].rstrip() + "..."
    return description


def _derive_event_from_person_actions(persons: list[dict]) -> str:
    actions_per_person = [
        {
            re.sub(r"[_-]+", " ", str(action).lower()).strip()
            for action in person.get("action", [])
            if str(action).strip()
        }
        for person in persons
    ]
    speakers = sum(
        any(action in {"talking", "speaking", "chatting"} for action in actions)
        for actions in actions_per_person
    )
    if speakers >= 2:
        return "conversation"

    all_actions = {action for actions in actions_per_person for action in actions}
    if all_actions & {"singing", "playing piano", "playing guitar"}:
        return "music_performance"
    if "dancing" in all_actions:
        return "dance_performance"
    for action, event_type in (
        ("cooking", "cooking"),
        ("eating", "eating"),
        ("cleaning", "cleaning"),
        ("repairing", "repairing"),
        ("shopping", "shopping"),
        ("exercising", "exercising"),
        ("studying", "studying"),
        ("working", "working"),
    ):
        if action in all_actions:
            return event_type
    return ""


def _pick(
    value: str | None,
    options: list[str],
    default: str,
    aliases: dict[str, str] | None = None,
) -> str:
    if not value:
        return default
    v = str(value).lower().strip()
    if aliases and v in aliases and aliases[v] in options:
        return aliases[v]
    if v in options:
        return v
    # Accept an option embedded as a complete word/phrase (for example,
    # "female adult"), but never as a substring ("male" in "female").
    for opt in sorted(options, key=len, reverse=True):
        if re.search(rf"(?<![a-z0-9]){re.escape(opt)}(?![a-z0-9])", v):
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
        model_ref = resolve_model_reference("qwen_vl", self._model_name)
        logger.info("Loading Qwen3-VL-2B v2 (short prompt): %s", model_ref)

        load_kwargs = model_load_kwargs("qwen_vl", model_ref)
        model_dtype = torch.bfloat16 if DEVICE == "cuda" else torch.float32
        self._processor = AutoProcessor.from_pretrained(
            model_ref, trust_remote_code=True, **load_kwargs
        )
        self._model = Qwen3VLForConditionalGeneration.from_pretrained(
            model_ref,
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
                raise RuntimeError("Qwen3-VL returned an empty or invalid semantic response")

            return SegmentSemantic(
                scene=parsed.get("scene", {"tags": [], "place": {"type": "unknown", "indoor": True, "weather": None, "lighting": "unknown", "timeOfDay": "unknown"}}),
                camera=parsed.get("camera", {"shot": "unknown", "angle": "unknown", "movement": [], "lens": "unknown", "stabilization": "unknown"}),
                persons_attributes=parsed.get("persons_attributes", []),
                objects_attributes=parsed.get("objects_attributes", []),
                events=parsed.get("events", []),
            )
        except Exception as e:
            logger.warning("Qwen3-VL failed: %s (%s)", type(e).__name__, e)
            if isinstance(e, RuntimeError):
                raise
            raise RuntimeError(
                f"Qwen3-VL semantic inference failed: {type(e).__name__}: {e}"
            ) from e
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
