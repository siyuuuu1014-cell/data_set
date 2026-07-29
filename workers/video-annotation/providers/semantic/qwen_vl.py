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
persons: a list of clearly visible people; for each include trackId, gender,
ageGroup, hair {color, style}, expression, pose, action (list), facing, and
clothing (list of {type, color, attributes, brand})
objects: a list of clearly visible non-person objects; for each include trackId, name, category, color, and brand

Rules:
- Never guess an object, person, action, or event that is not visually supported.
- If an object is uncertain or too small to identify, omit it from objects.
- Use an empty list when no person or object is clearly visible.
- Use "unknown" for an uncertain attribute instead of inventing a value.
- When boxes are labelled P<number> or O<number>, copy that exact number into
  trackId. Never infer Track identity from list order and never invent an ID.
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


def _safe_track_id(value: Any, allowed_track_ids: set[int] | None = None) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        labelled = re.fullmatch(r"\s*[PpOo]?\s*#?\s*(\d+)\s*", value)
        if labelled:
            value = labelled.group(1)
    try:
        track_id = int(value)
    except (TypeError, ValueError):
        return None
    if track_id < 0 or (allowed_track_ids is not None and track_id not in allowed_track_ids):
        return None
    return track_id


_APPEARANCE_COLORS = (
    "black", "brown", "blonde", "gray", "white", "red", "pink", "blue",
    "green", "purple", "orange", "yellow", "silver", "gold", "multicolored",
)
_HAIR_STYLES = (
    "short", "long", "curly", "straight", "wavy", "bald", "tied",
    "ponytail", "pigtails", "braided", "bob", "bun", "spiky",
)


def _semantic_label(value: Any, default: str = "unknown") -> str:
    if value is None or isinstance(value, (dict, list, tuple, set)):
        return default
    normalized = re.sub(r"\s+", " ", str(value)).strip().lower()
    return normalized if normalized else default


def _semantic_list(value: Any) -> list[str]:
    values = value if isinstance(value, list) else str(value or "").split(",")
    return [
        normalized
        for item in values
        if (normalized := _semantic_label(item, ""))
    ]


def _appearance_color(value: Any) -> str:
    normalized = _semantic_label(value)
    aliases = {"grey": "gray", "blond": "blonde", "multi-colored": "multicolored"}
    normalized = aliases.get(normalized, normalized)
    if normalized in _APPEARANCE_COLORS:
        return normalized
    for color in _APPEARANCE_COLORS:
        if re.search(rf"(?<![a-z]){re.escape(color)}(?![a-z])", normalized):
            return color
    return "unknown"


def _hair_attributes(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        color_source = value.get("color")
        style_source = value.get("style")
    else:
        color_source = value
        style_source = value
    style_text = _semantic_label(style_source)
    style = next((
        item for item in _HAIR_STYLES
        if re.search(rf"(?<![a-z]){re.escape(item)}(?![a-z])", style_text)
    ), "unknown")
    return {"color": _appearance_color(color_source), "style": style}


def _clothing_attributes(value: Any) -> list[dict[str, Any]]:
    if not value:
        return []
    values = value if isinstance(value, list) else [
        item for item in str(value).split(",") if item.strip()
    ]
    clothing: list[dict[str, Any]] = []
    for raw_item in values:
        if isinstance(raw_item, dict):
            clothing_type = _semantic_label(
                raw_item.get("type") or raw_item.get("name"), "unknown"
            )
            color = _appearance_color(raw_item.get("color"))
            attributes = _semantic_list(raw_item.get("attributes", []))
            brand_value = raw_item.get("brand")
            brand = None if brand_value in (None, "", "unknown") else str(brand_value).strip()
        else:
            text = _semantic_label(raw_item, "")
            if not text:
                continue
            main, _, detail = text.partition(" with ")
            words = main.split()
            clothing_type = words[-1] if words else "unknown"
            color = _appearance_color(main)
            attributes = [detail] if detail else []
            brand = None
        if clothing_type == "unknown" and color == "unknown" and not attributes and not brand:
            continue
        clothing.append({
            "type": clothing_type,
            "color": color,
            "attributes": attributes,
            "brand": brand,
        })
    return clothing


def _fill_single_person_hair_from_description(
    persons: list[dict[str, Any]],
    description: Any,
) -> None:
    """Keep a one-person structured card consistent with explicit prose.

    The fallback is intentionally limited to exactly one Track and requires
    an explicit "<color> hair" or "<color>-haired" phrase. Multi-person
    descriptions remain untouched because attribution would be ambiguous.
    """
    if len(persons) != 1:
        return
    hair = persons[0].get("hair")
    if not isinstance(hair, dict) or hair.get("color") not in (None, "", "unknown"):
        return
    text = _semantic_label(description, "")
    for color in _APPEARANCE_COLORS:
        if re.search(
            rf"(?<![a-z]){re.escape(color)}(?:[-\s]+(?:colored[-\s]+)?hair(?:ed)?)(?![a-z])",
            text,
        ):
            hair["color"] = color
            return


def _parse_response(raw: str, allowed_track_ids: set[int] | None = None) -> dict:
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
    for p in data.get("persons") or []:
        if not isinstance(p, dict):
            continue
        track_id = _safe_track_id(p.get("trackId"), allowed_track_ids)
        if allowed_track_ids is not None and track_id is None:
            continue
        person = {
            # Identity is assigned by the video-scoped tracker. Semantic
            # attributes are not unique enough to identify a real person.
            "personId": None,
            "gender": _pick(p.get("gender"), ["male", "female"], "unknown"),
            "ageGroup": _pick(
                p.get("ageGroup", p.get("age")),
                ["child", "teen", "young adult", "middle aged", "elderly"],
                "unknown",
                aliases={"young": "young adult", "middle": "middle aged"},
            ),
            "expression": _semantic_label(p.get("expression")),
            "pose": _semantic_label(p.get("pose")),
            "action": [],
            "facing": _semantic_label(p.get("facing")),
            "hair": _hair_attributes(p.get("hair")),
            "clothing": _clothing_attributes(p.get("clothing")),
        }
        if track_id is not None:
            person["trackId"] = track_id

        # Parse action
        person["action"] = _semantic_list(p.get("action"))

        persons_attrs.append(person)

    # --- Parse objects ---
    objects_attrs: list[dict] = []
    for o in data.get("objects") or []:
        if not isinstance(o, dict):
            continue
        track_id = _safe_track_id(o.get("trackId"), allowed_track_ids)
        if allowed_track_ids is not None and track_id is None:
            continue
        item = {
            "name": str(o.get("name", "")),
            "category": str(o.get("category", "other")),
            "color": str(o.get("color", "unknown")),
            "brand": o.get("brand") or None,
        }
        if track_id is not None:
            item["trackId"] = track_id
        objects_attrs.append(item)

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
    _fill_single_person_hair_from_description(persons_attrs, raw_description)
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
        track_candidates: list[dict] | None = None,
    ) -> 'SegmentSemantic':
        from .base import SegmentSemantic

        if not self._loaded:
            self.load()

        if not frame_paths or len(frame_paths) == 0:
            return self._empty()

        selected_paths = list(frame_paths)[:3]
        images: list[Image.Image] = []
        try:
            for image_path in selected_paths:
                with Image.open(image_path) as source:
                    images.append(source.convert("RGB"))
            logger.info(
                "Qwen3-VL processing %d Track-aware frame(s): %s",
                len(images),
                ", ".join(f"{image.width}x{image.height}" for image in images),
            )

            candidates = [
                item for item in (track_candidates or [])
                if isinstance(item, dict) and isinstance(item.get("trackId"), int)
            ]
            candidate_lines = "\n".join(
                f"- trackId {item['trackId']}: {item.get('entityType', 'object')} "
                f"({item.get('className', 'unknown')})"
                for item in candidates
            )
            user_instruction = "Describe these chronological frames as JSON."
            if candidate_lines:
                user_instruction = (
                    "The frames contain labelled detector boxes. Analyse only the listed "
                    "entities and return their exact numeric trackId with their attributes. "
                    "A P label is a person and an O label is an object. Omit a candidate if "
                    "its attributes are not visually supported; do not match by array order.\n"
                    f"Candidates:\n{candidate_lines}"
                )

            messages = [
                {"role": "system", "content": PROMPT},
                {
                    "role": "user",
                    "content": [
                        *({"type": "image", "image": image} for image in images),
                        {"type": "text", "text": user_instruction},
                    ],
                },
            ]

            text = self._processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            inputs = self._processor(
                text=[text], images=images, return_tensors="pt"
            )
            inputs = {k: v.to(DEVICE) for k, v in inputs.items()}

            with torch.inference_mode():
                generated = self._model.generate(
                    **inputs,
                    max_new_tokens=1200,
                    temperature=0.3,
                    do_sample=False,
                    use_cache=True,
                )

            input_len = inputs["input_ids"].shape[1]
            output_ids = generated[0][input_len:]
            raw_text = self._processor.decode(output_ids, skip_special_tokens=True)
            logger.info("Qwen3-VL raw: %.400s", raw_text)

            allowed_track_ids = {
                int(item["trackId"])
                for item in candidates
            } if candidates else None
            parsed = _parse_response(raw_text, allowed_track_ids=allowed_track_ids)
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
            for image in images:
                image.close()
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
