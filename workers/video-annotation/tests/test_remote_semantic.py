from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline import _semantic_provider_enabled
from providers.semantic.remote_api import (
    RemoteApiSemantic,
    _parse_remote_response,
    read_remote_semantic_config,
)


SEMANTIC_JSON = json.dumps({
    "scene": {
        "tags": [],
        "place": {
            "type": "unknown",
            "indoor": True,
            "weather": None,
            "lighting": "unknown",
            "timeOfDay": "unknown",
        },
    },
    "camera": {
        "shot": "unknown",
        "angle": "unknown",
        "movement": [],
        "lens": "unknown",
        "stabilization": "unknown",
    },
    "persons_attributes": [],
    "objects_attributes": [],
    "events": [{
        "type": "visual_activity",
        "description": "A test image is visible.",
        "confidence": 0.7,
    }],
})


class _Response:
    def __init__(self, payload: dict) -> None:
        self._payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def read(self, _size: int = -1) -> bytes:
        return self._payload


class RemoteSemanticPayloadTests(unittest.TestCase):
    def _provider(self, api_format: str) -> RemoteApiSemantic:
        provider = RemoteApiSemantic({
            "mode": "remote",
            "apiKey": "test-key",
            "baseUrl": "http://localhost:9999/v1",
            "model": "vision-model",
            "apiFormat": api_format,
        })
        provider.load()
        return provider

    def test_openai_payload_uses_data_url_images(self) -> None:
        captured = {}

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return _Response({"choices": [{"message": {"content": SEMANTIC_JSON}}]})

        provider = self._provider("openai")
        with patch("providers.semantic.remote_api.urlopen", side_effect=fake_urlopen):
            result = provider._request([("image/jpeg", "YWJj")], "Describe frames")

        request = captured["request"]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(result, SEMANTIC_JSON)
        self.assertEqual(request.full_url, "http://localhost:9999/v1/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(
            payload["messages"][1]["content"][0]["image_url"]["url"],
            "data:image/jpeg;base64,YWJj",
        )

    def test_anthropic_payload_uses_base64_image_blocks(self) -> None:
        captured = {}

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return _Response({"content": [{"type": "text", "text": SEMANTIC_JSON}]})

        provider = self._provider("anthropic")
        with patch("providers.semantic.remote_api.urlopen", side_effect=fake_urlopen):
            result = provider._request([("image/jpeg", "YWJj")], "Describe frames")

        request = captured["request"]
        payload = json.loads(request.data.decode("utf-8"))
        image_block = payload["messages"][0]["content"][0]
        self.assertEqual(result, SEMANTIC_JSON)
        self.assertEqual(request.full_url, "http://localhost:9999/v1/messages")
        self.assertEqual(request.get_header("X-api-key"), "test-key")
        self.assertEqual(image_block["source"]["type"], "base64")
        self.assertEqual(image_block["source"]["data"], "YWJj")

    def test_response_parser_normalizes_compatible_service_output(self) -> None:
        parsed = _parse_remote_response(json.dumps({
            "scene": {"place": {"indoor": "false"}},
            "camera": {},
            "persons_attributes": [],
            "objects_attributes": [],
            "events": [{
                "type": "unlisted event",
                "description": "  A person moves.  ",
                "confidence": 2,
            }],
        }))
        self.assertFalse(parsed["scene"]["place"]["indoor"])
        self.assertEqual(parsed["events"][0]["type"], "visual_activity")
        self.assertEqual(parsed["events"][0]["description"], "A person moves.")
        self.assertEqual(parsed["events"][0]["confidence"], 1.0)

    def test_missing_config_defaults_to_local_but_invalid_config_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "video-semantic-config.json"
            with patch("providers.semantic.remote_api.VIDEO_SEMANTIC_CONFIG_FILE", config_path):
                self.assertEqual(read_remote_semantic_config()["mode"], "local")
                config_path.write_text("not json", encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "invalid JSON"):
                    read_remote_semantic_config()


class SemanticProviderSelectionTests(unittest.TestCase):
    def test_remote_mode_does_not_depend_on_local_qwen_install_state(self) -> None:
        with patch("pipeline.is_provider_enabled", return_value=False):
            self.assertTrue(_semantic_provider_enabled({}, remote_mode=True))
            self.assertFalse(_semantic_provider_enabled({}, remote_mode=False))

    def test_explicit_job_opt_out_disables_local_and_remote_semantics(self) -> None:
        options = {"providers": {"qwen_vl": False}}
        self.assertFalse(_semantic_provider_enabled(options, remote_mode=True))
        self.assertFalse(_semantic_provider_enabled(options, remote_mode=False))


if __name__ == "__main__":
    unittest.main()
