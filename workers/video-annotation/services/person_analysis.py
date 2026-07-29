"""Targeted, preview-only semantic analysis for one selected person box."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from providers.registry import create_provider, mark_loaded
from providers.semantic.remote_api import RemoteApiSemantic, semantic_inference_mode
from services.frame_sampling import extract_keyframe


def _label(value: Any) -> str:
    text = str(value or "").strip()
    return text or "unknown"


def normalize_person_attributes(value: Any) -> dict[str, Any]:
    """Return the existing editable Person fields without spatial/identity data."""
    source = value if isinstance(value, dict) else {}
    hair_source = source.get("hair") if isinstance(source.get("hair"), dict) else {}
    actions = source.get("action") if isinstance(source.get("action"), list) else []
    clothing_source = source.get("clothing") if isinstance(source.get("clothing"), list) else []
    clothing: list[dict[str, Any]] = []
    for item in clothing_source:
        if not isinstance(item, dict):
            continue
        clothing.append({
            "type": _label(item.get("type")),
            "color": _label(item.get("color")),
            "attributes": [
                str(attribute).strip()
                for attribute in item.get("attributes", [])
                if str(attribute).strip()
            ] if isinstance(item.get("attributes"), list) else [],
            "brand": str(item["brand"]).strip() if item.get("brand") else None,
        })
    try:
        occlusion = min(1.0, max(0.0, float(source.get("occlusion", 0))))
    except (TypeError, ValueError):
        occlusion = 0.0
    return {
        "gender": _label(source.get("gender")),
        "ageGroup": _label(source.get("ageGroup")),
        "hair": {
            "color": _label(hair_source.get("color")),
            "style": _label(hair_source.get("style")),
        },
        "expression": _label(source.get("expression")),
        "pose": _label(source.get("pose")),
        "action": [str(action).strip() for action in actions if str(action).strip()],
        "facing": _label(source.get("facing")),
        "occlusion": occlusion,
        "clothing": clothing,
    }


def _crop_person(
    frame_path: str,
    output_path: str,
    bbox: dict[str, Any],
    reference_width: float,
    reference_height: float,
) -> None:
    if reference_width <= 0 or reference_height <= 0:
        raise ValueError("Person analysis image dimensions must be positive")
    try:
        x = float(bbox["x"])
        y = float(bbox["y"])
        width = float(bbox["width"])
        height = float(bbox["height"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Person analysis bbox is invalid") from error
    if width <= 0 or height <= 0:
        raise ValueError("Person analysis bbox must be positive")

    with Image.open(frame_path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        scale_x = image.width / reference_width
        scale_y = image.height / reference_height
        left = x * scale_x
        top = y * scale_y
        right = (x + width) * scale_x
        bottom = (y + height) * scale_y
        padding_x = max(4.0, (right - left) * 0.08)
        padding_y = max(4.0, (bottom - top) * 0.08)
        crop_box = (
            max(0, int(round(left - padding_x))),
            max(0, int(round(top - padding_y))),
            min(image.width, int(round(right + padding_x))),
            min(image.height, int(round(bottom + padding_y))),
        )
        if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
            raise ValueError("Person analysis bbox does not overlap the decoded frame")
        image.crop(crop_box).save(output_path, format="JPEG", quality=92)


def run_person_analysis(
    video_path: str,
    timestamp: float,
    bbox: dict[str, Any],
    image_width: float,
    image_height: float,
) -> dict[str, Any]:
    """Analyze one selected crop and return a candidate without mutating annotations."""
    if timestamp < 0:
        raise ValueError("Person analysis timestamp must be non-negative")

    with tempfile.TemporaryDirectory(prefix="nuwa_person_analysis_") as output_dir:
        frame_path = extract_keyframe(video_path, timestamp, output_dir=output_dir)
        crop_path = str(Path(output_dir) / "person.jpg")
        _crop_person(frame_path, crop_path, bbox, image_width, image_height)

        mode = semantic_inference_mode()
        provider: Any
        provider_id: str | None = None
        if mode == "remote":
            provider = RemoteApiSemantic()
        else:
            provider_id = "qwen_vl"
            provider = create_provider(provider_id)

        try:
            provider.load()
            if provider_id:
                mark_loaded(provider_id, True)
            semantic = provider.annotate_semantic(
                video_path=video_path,
                frame_paths=[crop_path],
                start=timestamp,
                end=timestamp,
                ontology={},
                prompt_template="",
                examples=[],
            )
        finally:
            try:
                provider.unload()
            finally:
                if provider_id:
                    mark_loaded(provider_id, False)

        candidates = getattr(semantic, "persons_attributes", []) or []
        if not candidates:
            raise RuntimeError("The semantic model did not identify a person in the selected box")
        return {
            "person": normalize_person_attributes(candidates[0]),
            "source": "remote_api" if mode == "remote" else "local_qwen",
            "timestamp": float(timestamp),
        }
