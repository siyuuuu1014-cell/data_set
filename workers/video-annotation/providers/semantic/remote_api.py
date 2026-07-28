"""Remote multimodal semantic provider for OpenAI/Anthropic-compatible APIs.

This provider replaces only the local Qwen semantic stage. Detection, tracking,
OCR, speech, depth, merging, review, and export continue through the existing
pipeline.
"""

from __future__ import annotations

import base64
import ipaddress
import json
import logging
import os
import socket
import re
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

from config import VIDEO_SEMANTIC_CONFIG_FILE
from providers.semantic.base import SegmentSemantic

logger = logging.getLogger(__name__)

MAX_IMAGES = 3
MAX_IMAGE_SIDE = 1024
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 120

REMOTE_PROMPT = """Analyze chronological keyframes from one video segment.
Return only one JSON object using exactly this structure:
{
  "scene": {"tags": [], "place": {"type": "unknown", "indoor": true, "weather": null, "lighting": "unknown", "timeOfDay": "unknown"}},
  "camera": {"shot": "unknown", "angle": "unknown", "movement": [], "lens": "unknown", "stabilization": "unknown"},
  "persons_attributes": [{"gender": "unknown", "ageGroup": "unknown", "hair": {"color": "unknown", "style": "unknown"}, "expression": "unknown", "pose": "unknown", "action": [], "facing": "unknown", "occlusion": 0, "clothing": []}],
  "objects_attributes": [{"name": "", "category": "other", "color": "unknown", "brand": null}],
  "events": [{"type": "visual_activity", "description": "One short sentence about visible activity.", "confidence": 0.7}]
}
Use empty arrays when nothing is visible. Never invent a person, object, action,
event, text, identity, cause, or outcome. Do not use speech as visual evidence.
Event type must be one of: music_performance, sports_activity,
dance_performance, conversation, argument, celebration, ceremony, cooking,
eating, cleaning, repairing, shopping, commuting, exercising, playing,
studying, working, accident, emergency, visual_activity, unknown.
Return JSON only, without markdown."""

_EVENT_TYPES = {
    "music_performance", "sports_activity", "dance_performance", "conversation",
    "argument", "celebration", "ceremony", "cooking", "eating", "cleaning",
    "repairing", "shopping", "commuting", "exercising", "playing", "studying",
    "working", "accident", "emergency", "visual_activity", "unknown",
}


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "1"}:
            return True
        if normalized in {"false", "no", "0"}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def _parse_remote_response(raw: str) -> dict[str, Any]:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
    text = fenced.group(1) if fenced else raw
    candidate = re.search(r"\{[\s\S]*", text)
    raw_json = candidate.group(0) if candidate else text
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError:
        try:
            import json_repair

            data = json.loads(json_repair.repair_json(raw_json))
        except Exception:
            return {}
    if not isinstance(data, dict):
        return {}
    if not {"scene", "camera", "persons_attributes", "objects_attributes", "events"}.intersection(data):
        return {}

    scene = data.get("scene") if isinstance(data.get("scene"), dict) else {}
    place = scene.get("place") if isinstance(scene.get("place"), dict) else {}
    normalized_scene = {
        "tags": [str(item) for item in scene.get("tags", []) if str(item).strip()]
        if isinstance(scene.get("tags"), list) else [],
        "place": {
            "type": str(place.get("type") or "unknown"),
            "indoor": _as_bool(place.get("indoor"), True),
            "weather": place.get("weather") if place.get("weather") is None else str(place.get("weather")),
            "lighting": str(place.get("lighting") or "unknown"),
            "timeOfDay": str(place.get("timeOfDay") or "unknown"),
        },
    }

    camera = data.get("camera") if isinstance(data.get("camera"), dict) else {}
    normalized_camera = {
        "shot": str(camera.get("shot") or "unknown"),
        "angle": str(camera.get("angle") or "unknown"),
        "movement": [str(item) for item in camera.get("movement", []) if str(item).strip()]
        if isinstance(camera.get("movement"), list) else [],
        "lens": str(camera.get("lens") or "unknown"),
        "stabilization": str(camera.get("stabilization") or "unknown"),
    }

    persons = [
        item for item in data.get("persons_attributes", [])
        if isinstance(item, dict)
    ] if isinstance(data.get("persons_attributes"), list) else []
    objects = [
        item for item in data.get("objects_attributes", [])
        if isinstance(item, dict) and str(item.get("name") or "").strip()
    ] if isinstance(data.get("objects_attributes"), list) else []
    events: list[dict[str, Any]] = []
    if isinstance(data.get("events"), list):
        for item in data["events"]:
            if not isinstance(item, dict):
                continue
            event_type = str(item.get("type") or "unknown").strip().lower().replace(" ", "_")
            if event_type not in _EVENT_TYPES:
                event_type = "visual_activity"
            description = re.sub(r"\s+", " ", str(item.get("description") or "")).strip()
            confidence = item.get("confidence", 0.7)
            if not isinstance(confidence, (int, float)):
                confidence = 0.7
            events.append({
                "type": event_type,
                "description": description[:200],
                "confidence": min(1.0, max(0.0, float(confidence))),
            })

    return {
        "scene": normalized_scene,
        "camera": normalized_camera,
        "persons_attributes": persons,
        "objects_attributes": objects,
        "events": events,
    }


def read_remote_semantic_config() -> dict[str, Any]:
    """Read the independently stored video-semantic configuration."""
    try:
        raw = VIDEO_SEMANTIC_CONFIG_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {
            "mode": "local",
            "apiKey": "",
            "baseUrl": "",
            "model": "",
            "apiFormat": "openai",
        }
    except OSError as error:
        raise RuntimeError("Cannot read video semantic API configuration") from error
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("Video semantic API configuration is invalid JSON") from error
    if not isinstance(data, dict):
        raise RuntimeError("Video semantic API configuration is invalid")
    return data


def semantic_inference_mode() -> str:
    mode = str(read_remote_semantic_config().get("mode", "local")).strip().lower()
    return "remote" if mode == "remote" else "local"


def _allowed_private_hosts() -> set[str]:
    return {
        item.strip().lower()
        for item in os.environ.get("NUWA_LLM_ALLOWED_PRIVATE_HOSTS", "").split(",")
        if item.strip()
    }


def _validate_request_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError("Remote semantic Base URL must use http:// or https://")
    if parsed.username or parsed.password:
        raise RuntimeError("Remote semantic Base URL cannot contain credentials")

    hostname = parsed.hostname.lower()
    if hostname == "localhost" or hostname in _allowed_private_hosts():
        return
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as error:
        raise RuntimeError(f"Cannot resolve remote semantic host: {hostname}") from error
    if not addresses:
        raise RuntimeError(f"Cannot resolve remote semantic host: {hostname}")
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address)
        except ValueError as error:
            raise RuntimeError("Remote semantic host resolved to an invalid address") from error
        if ip.is_loopback:
            continue
        if not ip.is_global:
            raise RuntimeError(
                "Remote semantic host resolves to a private or reserved address; "
                "allow it with NUWA_LLM_ALLOWED_PRIVATE_HOSTS if intentional"
            )


def _endpoint(base_url: str, api_format: str) -> str:
    suffix = "/messages" if api_format == "anthropic" else "/chat/completions"
    return f"{base_url.rstrip('/')}{suffix}"


def _encode_image(path: str) -> tuple[str, str]:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="JPEG", quality=82, optimize=True)
    return "image/jpeg", base64.b64encode(output.getvalue()).decode("ascii")


def _read_json_response(response: Any) -> dict[str, Any]:
    raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise RuntimeError("Remote semantic response exceeded 4 MiB")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Remote semantic API returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Remote semantic API returned an invalid response object")
    return payload


def _response_text(payload: dict[str, Any], api_format: str) -> str:
    if api_format == "anthropic":
        blocks = payload.get("content")
        if isinstance(blocks, list):
            return "".join(
                str(block.get("text", ""))
                for block in blocks
                if isinstance(block, dict) and block.get("type") == "text"
            )
    choices = payload.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content
    if isinstance(payload.get("content"), str):
        return str(payload["content"])
    raise RuntimeError("Remote semantic API response contained no text")


class RemoteApiSemantic:
    """Semantic provider that sends up to three chronological keyframes."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._config = config
        self._loaded = False

    @property
    def model_name(self) -> str:
        return str((self._config or {}).get("model", ""))

    def load(self) -> None:
        config = dict(self._config or read_remote_semantic_config())
        if str(config.get("mode", "local")).lower() != "remote":
            raise RuntimeError("Remote semantic API is not enabled")
        api_format = str(config.get("apiFormat", "openai")).lower()
        if api_format not in {"openai", "anthropic"}:
            raise RuntimeError("Remote semantic API format must be openai or anthropic")
        if not str(config.get("baseUrl", "")).strip():
            raise RuntimeError("Remote semantic Base URL is missing")
        if not str(config.get("model", "")).strip():
            raise RuntimeError("Remote semantic model is missing")
        config["apiFormat"] = api_format
        config["baseUrl"] = str(config["baseUrl"]).strip()
        config["model"] = str(config["model"]).strip()
        config["apiKey"] = str(config.get("apiKey", "")).strip()
        _validate_request_url(_endpoint(config["baseUrl"], api_format))
        self._config = config
        self._loaded = True

    def unload(self) -> None:
        self._loaded = False

    def _request(self, encoded_images: list[tuple[str, str]], user_prompt: str) -> str:
        if not self._loaded or self._config is None:
            self.load()
        assert self._config is not None
        api_format = self._config["apiFormat"]
        endpoint = _endpoint(self._config["baseUrl"], api_format)
        headers = {"Content-Type": "application/json"}
        api_key = self._config["apiKey"]

        if api_format == "anthropic":
            if api_key:
                headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
            content: list[dict[str, Any]] = [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data,
                    },
                }
                for media_type, data in encoded_images
            ]
            content.append({"type": "text", "text": user_prompt})
            body = {
                "model": self._config["model"],
                "max_tokens": 1000,
                "temperature": 0,
                "system": REMOTE_PROMPT,
                "messages": [{"role": "user", "content": content}],
            }
        else:
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            content = [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{media_type};base64,{data}", "detail": "auto"},
                }
                for media_type, data in encoded_images
            ]
            content.append({"type": "text", "text": user_prompt})
            body = {
                "model": self._config["model"],
                "messages": [
                    {"role": "system", "content": REMOTE_PROMPT},
                    {"role": "user", "content": content},
                ],
                "temperature": 0,
                "max_tokens": 1000,
            }

        request = Request(
            endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                payload = _read_json_response(response)
        except HTTPError as error:
            detail = error.read(2048).decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Remote semantic API returned HTTP {error.code}: {detail or error.reason}"
            ) from error
        except (URLError, TimeoutError, OSError) as error:
            raise RuntimeError(f"Remote semantic API request failed: {error}") from error
        return _response_text(payload, api_format)

    def annotate_semantic(
        self,
        video_path: str = "",
        frame_paths: list[str] | None = None,
        start: float = 0,
        end: float = 0,
        ontology: dict | None = None,
        prompt_template: str = "",
        examples: list[dict] | None = None,
    ) -> SegmentSemantic:
        if not self._loaded:
            self.load()
        selected_paths = list(frame_paths or [])[:MAX_IMAGES]
        if not selected_paths:
            return SegmentSemantic(
                scene={"tags": [], "place": {"type": "unknown", "indoor": True, "weather": None, "lighting": "unknown", "timeOfDay": "unknown"}},
                camera={"shot": "unknown", "angle": "unknown", "movement": [], "lens": "unknown", "stabilization": "unknown"},
                persons_attributes=[],
                objects_attributes=[],
                events=[],
            )
        images = [_encode_image(path) for path in selected_paths]
        raw_text = self._request(
            images,
            "The images are chronological keyframes from one video segment "
            f"({start:.2f}s to {end:.2f}s). Describe their shared visible content and main visible activity as JSON.",
        )
        logger.info("Remote semantic response received (model=%s, chars=%d)", self.model_name, len(raw_text))
        parsed = _parse_remote_response(raw_text)
        if not parsed:
            raise RuntimeError("Remote semantic API returned an empty or invalid semantic response")
        return SegmentSemantic(
            scene=parsed.get("scene", {}),
            camera=parsed.get("camera", {}),
            persons_attributes=parsed.get("persons_attributes", []),
            objects_attributes=parsed.get("objects_attributes", []),
            events=parsed.get("events", []),
        )

    def test_connection(self) -> dict[str, str]:
        if not self._loaded:
            self.load()
        image = Image.new("RGB", (64, 64), color=(32, 64, 96))
        output = BytesIO()
        image.save(output, format="JPEG", quality=75)
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        response = self._request(
            [("image/jpeg", encoded)],
            'Return the required structured JSON. Use scene and camera defaults, empty persons_attributes and objects_attributes, and one visual_activity event describing the test image.',
        )
        if not _parse_remote_response(response):
            raise RuntimeError("The API responded, but did not return usable semantic JSON")
        return {"status": "ok", "model": self.model_name}
