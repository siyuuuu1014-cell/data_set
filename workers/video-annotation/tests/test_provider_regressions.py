from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
import torch
from PIL import Image

import pipeline
from config import DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_IOU_THRESHOLD
from pipeline import (
    DEFAULT_GROUNDING_CATEGORIES,
    _deduplicate_ocr_texts,
    _degraded_visual_providers,
    _detector_confidence_for_tracking,
    _prepare_semantic_track_frames,
    _semantic_tracks_with_review_candidates,
    _select_grounding_categories,
)
from providers.detector.yolo11 import YOLO11Detector
from providers.grounding import locate_anything
from providers.grounding.locate_anything import (
    LOCATE_ATTN_IMPLEMENTATION,
    LocateAnythingGrounding,
    _category_query,
    _resize_for_inference,
)
from providers.ocr.trocr import TrOCRProvider
from providers import registry
from providers.semantic import qwen_vl
from providers.semantic.base import SegmentSemantic
from providers.semantic.qwen_vl import PROMPT, QwenVLSemantic, _parse_response, _pick
from providers.tracker.base import FrameTrack
from services.merge_service import merge_results


class SemanticPickTests(unittest.TestCase):
    def test_prompt_does_not_seed_specific_object_hallucinations(self) -> None:
        self.assertNotIn("butterfly", PROMPT.lower())
        self.assertIn("never guess", PROMPT.lower())

    def test_free_form_event_is_normalized_to_ontology(self) -> None:
        parsed = _parse_response(
            '{"scene":"restaurant","lighting":"bright","indoor":true,'
            '"camera_angle":"eye-level","persons":[],"objects":[],'
            '"event":"Two people are talking to each other."}'
        )
        self.assertEqual(parsed["events"], [{
            "type": "conversation",
            "description": "Two people are talking to each other.",
            "confidence": 0.7,
        }])

    def test_two_speakers_derive_conversation_but_one_does_not(self) -> None:
        common = (
            '{"scene":"restaurant","lighting":"bright","indoor":true,'
            '"camera_angle":"eye-level","objects":[],"event":"","persons":'
        )
        two = _parse_response(
            common
            + '[{"gender":"male","age":"unknown","action":"talking","clothing":"","hair":""},'
            '{"gender":"female","age":"unknown","action":"speaking","clothing":"","hair":""}]}'
        )
        one = _parse_response(
            common
            + '[{"gender":"male","age":"unknown","action":"talking","clothing":"","hair":""},'
            '{"gender":"female","age":"unknown","action":"standing","clothing":"","hair":""}]}'
        )
        self.assertEqual(two["events"], [{
            "type": "conversation",
            "description": "Multiple people are visibly talking with each other.",
            "confidence": 0.65,
        }])
        self.assertEqual(one["events"], [])

    def test_female_does_not_match_male_substring(self) -> None:
        self.assertEqual(_pick("female", ["male", "female"], "unknown"), "female")
        self.assertEqual(_pick("female adult", ["male", "female"], "unknown"), "female")

    def test_age_aliases_preserve_short_qwen_outputs(self) -> None:
        aliases = {"young": "young adult", "middle": "middle aged"}
        options = ["child", "teen", "young adult", "middle aged", "elderly"]
        self.assertEqual(_pick("young", options, "unknown", aliases=aliases), "young adult")
        self.assertEqual(_pick("middle", options, "unknown", aliases=aliases), "middle aged")

    def test_qwen_parser_preserves_only_allowed_explicit_track_ids(self) -> None:
        parsed = _parse_response(
            '{"scene":"room","persons":['
            '{"trackId":9,"gender":"female","action":"reading"},'
            '{"trackId":99,"gender":"male","action":"standing"},'
            '{"gender":"male","action":"walking"}],'
            '"objects":[{"trackId":4,"name":"book"}]}'
            , allowed_track_ids={4, 9}
        )

        self.assertEqual([item.get("trackId") for item in parsed["persons_attributes"]], [9])
        self.assertEqual(parsed["objects_attributes"][0]["trackId"], 4)

    def test_qwen_parser_accepts_visible_box_label_as_explicit_track_id(self) -> None:
        parsed = _parse_response(
            '{"scene":"room","persons":['
            '{"trackId":"P1000002","gender":"female","action":"smiling"}]}',
            allowed_track_ids={1000002},
        )

        self.assertEqual(parsed["persons_attributes"][0]["trackId"], 1000002)

    def test_qwen_parser_preserves_structured_person_appearance_fields(self) -> None:
        parsed = _parse_response(
            '{"scene":"illustration","persons":[{'
            '"trackId":1,"gender":"female","ageGroup":"teen",'
            '"hair":{"color":"pink","style":"long"},'
            '"expression":"joyful","pose":"standing","action":["smiling"],'
            '"facing":"front","clothing":[{'
            '"type":"bow","color":"red","attributes":["large"],"brand":null}]}]}',
            allowed_track_ids={1},
        )

        person = parsed["persons_attributes"][0]
        self.assertEqual(person["hair"], {"color": "pink", "style": "long"})
        self.assertEqual(person["expression"], "joyful")
        self.assertEqual(person["pose"], "standing")
        self.assertEqual(person["action"], ["smiling"])
        self.assertEqual(person["facing"], "front")
        self.assertEqual(person["clothing"], [{
            "type": "bow", "color": "red", "attributes": ["large"], "brand": None,
        }])

    def test_qwen_parser_supports_non_photographic_hair_colors_in_text(self) -> None:
        parsed = _parse_response(
            '{"scene":"illustration","persons":['
            '{"trackId":1,"hair":"long purple hair","clothing":"pink jacket with emblem"}]}',
            allowed_track_ids={1},
        )

        person = parsed["persons_attributes"][0]
        self.assertEqual(person["hair"], {"color": "purple", "style": "long"})
        self.assertEqual(person["clothing"][0]["type"], "jacket")
        self.assertEqual(person["clothing"][0]["color"], "pink")

    def test_single_person_explicit_hair_description_fills_missing_structured_color(self) -> None:
        parsed = _parse_response(
            '{"scene":"illustration",'
            '"event_description":"A cartoon character with pink hair is shown.",'
            '"persons":[{"trackId":1,"hair":"unknown"}]}',
            allowed_track_ids={1},
        )

        self.assertEqual(parsed["persons_attributes"][0]["hair"]["color"], "pink")

    def test_multi_person_description_never_guesses_hair_owner(self) -> None:
        parsed = _parse_response(
            '{"scene":"illustration",'
            '"event_description":"A pink-haired character stands beside another person.",'
            '"persons":[{"trackId":1,"hair":"unknown"},{"trackId":2,"hair":"unknown"}]}',
            allowed_track_ids={1, 2},
        )

        self.assertEqual(
            [item["hair"]["color"] for item in parsed["persons_attributes"]],
            ["unknown", "unknown"],
        )


class SemanticTrackFrameTests(unittest.TestCase):
    def test_manual_review_candidate_is_added_only_to_semantic_track_copy(self) -> None:
        tracks = [FrameTrack(0, [])]
        with TemporaryDirectory() as directory:
            path = Path(directory) / "frame_0.jpg"
            Image.new("RGB", (200, 100), "white").save(path)
            semantic_tracks = _semantic_tracks_with_review_candidates(
                tracks,
                [str(path)],
                [{
                    "trackId": 1000002,
                    "entityType": "person",
                    "className": "person",
                    "bbox": {"x": 10, "y": 10, "width": 20, "height": 30},
                    "timestamp": 5.0,
                    "imageWidth": 100,
                    "imageHeight": 100,
                    "personId": "video:manual-person:1",
                }],
                segment_start=5.0,
                tracking_fps=3.0,
            )

        self.assertEqual(tracks[0].tracks, [])
        self.assertEqual(semantic_tracks[0].tracks[0]["trackId"], 1000002)
        self.assertEqual(semantic_tracks[0].tracks[0]["bbox"], [20.0, 10.0, 40.0, 30.0])
        self.assertEqual(semantic_tracks[0].tracks[0]["source"], "manual")

    def test_labelled_frames_and_manifest_use_real_track_ids(self) -> None:
        tracks = [
            FrameTrack(0, [{
                "trackId": 9, "className": "person", "bbox": [2, 3, 20, 30],
                "detectionConfidence": 0.9,
            }]),
            FrameTrack(1, [{
                "trackId": 4, "className": "book", "bbox": [5, 6, 15, 12],
                "detectionConfidence": 0.8,
            }]),
        ]
        with TemporaryDirectory() as directory:
            paths = []
            for index in range(2):
                path = Path(directory) / f"frame_{index}.jpg"
                Image.new("RGB", (64, 48), "white").save(path)
                paths.append(str(path))

            output_paths, candidates = _prepare_semantic_track_frames(
                paths, tracks, directory, max_frames=2,
            )

            self.assertEqual(len(output_paths), 2)
            self.assertTrue(all(Path(path).exists() for path in output_paths))
            self.assertEqual(
                {(item["trackId"], item["entityType"]) for item in candidates},
                {(9, "person"), (4, "object")},
            )


class ProviderCompatibilityTests(unittest.TestCase):
    def test_locate_anything_uses_supported_sdpa_attention(self) -> None:
        self.assertEqual(LOCATE_ATTN_IMPLEMENTATION, "sdpa")

    def test_locate_anything_rejects_unverified_transformers_version(self) -> None:
        with (
            patch.object(registry, "deployment_mode", return_value="enhanced"),
            patch.object(registry, "_missing_modules", return_value=[]),
            patch.object(registry, "package_version", return_value="5.14.1"),
        ):
            status = registry.provider_status("locate_anything", check_model=False)

        self.assertEqual(status.status, "incompatible_dependency")
        self.assertIn("transformers==4.57.1 required", status.reason or "")
        self.assertEqual(
            status.requiredPackageVersions,
            {
                "transformers": "4.57.1",
                "peft": "0.19.1",
                "decord": "0.6.0",
                "lmdb": "1.7.5",
            },
        )

    def test_locate_anything_declares_remote_code_dependencies(self) -> None:
        modules = registry.PROVIDER_SPECS["locate_anything"].modules
        self.assertIn("lmdb", modules)
        self.assertIn("peft", modules)
        self.assertIn("decord", modules)

    def test_locate_anything_uses_official_category_separator(self) -> None:
        self.assertEqual(
            _category_query([" person ", "", "car"]),
            "person</c>car",
        )

    def test_locate_anything_bounds_visual_input_without_stretching(self) -> None:
        original = Image.new("RGB", (2560, 1440), "white")
        resized = _resize_for_inference(original, 1024)
        try:
            self.assertEqual(resized.size, (1024, 576))
            self.assertEqual(original.size, (2560, 1440))
        finally:
            if resized is not original:
                resized.close()
            original.close()

    def test_locate_anything_uses_and_releases_local_optimized_runtime(self) -> None:
        with TemporaryDirectory() as temp_dir:
            batch_package = Path(temp_dir) / "batch_utils"
            batch_package.mkdir()
            (batch_package / "__init__.py").write_text("", encoding="utf-8")
            model = object()
            runtime = SimpleNamespace(_model=model, _proc="processor", _tok="tokenizer")
            batch_utils = SimpleNamespace(
                load=lambda: ("tokenizer", "processor", model),
            )
            provider = LocateAnythingGrounding(temp_dir)

            with (
                patch.object(locate_anything, "DEVICE", "cuda"),
                patch.object(
                    locate_anything.importlib,
                    "import_module",
                    side_effect=[batch_utils, runtime],
                ),
            ):
                self.assertTrue(provider._load_official_batch_runtime())
                self.assertIs(provider._model, model)
                provider._release_batch_runtime()

            self.assertIsNone(runtime._model)
            self.assertIsNone(runtime._proc)
            self.assertIsNone(runtime._tok)

    def test_cached_remote_model_loads_without_network_checks(self) -> None:
        with TemporaryDirectory() as temp_dir:
            cache = Path(temp_dir)
            config_path = cache / "config.json"
            weights_path = cache / "model.safetensors"
            config_path.write_text("{}", encoding="utf-8")
            weights_path.write_bytes(b"cached")

            def cached_file(
                _model_ref: str,
                filename: str,
                revision: str | None = None,
            ) -> str | None:
                self.assertEqual(revision, "main")
                if filename == "config.json":
                    return str(config_path)
                if filename == "model.safetensors":
                    return str(weights_path)
                return None

            with (
                patch.object(registry, "model_revision", return_value="main"),
                patch(
                    "huggingface_hub.try_to_load_from_cache",
                    side_effect=cached_file,
                ),
            ):
                kwargs = registry.model_load_kwargs("qwen_vl", "Qwen/test")
                resolved = registry.resolve_model_reference(
                    "qwen_vl",
                    "Qwen/test",
                )
                resolves_to_cache = Path(resolved).samefile(cache)

        self.assertEqual(kwargs, {
            "revision": "main",
            "local_files_only": True,
        })
        self.assertTrue(resolves_to_cache)

    def test_incomplete_remote_model_keeps_download_path(self) -> None:
        with (
            patch.object(registry, "model_revision", return_value="main"),
            patch(
                "huggingface_hub.try_to_load_from_cache",
                return_value=None,
            ),
        ):
            kwargs = registry.model_load_kwargs("qwen_vl", "Qwen/missing")

        self.assertEqual(kwargs, {"revision": "main"})

    def test_fast_override_bypasses_hybrid_batch_executor(self) -> None:
        class Processor:
            @staticmethod
            def apply_chat_template(*_args, **_kwargs) -> str:
                return "prompt"

            @staticmethod
            def process_vision_info(*_args, **_kwargs) -> tuple[list, list]:
                return [object()], []

            @staticmethod
            def __call__(*_args, **_kwargs) -> dict:
                return {
                    "pixel_values": torch.zeros((1, 3, 2, 2)),
                    "input_ids": torch.ones((1, 2), dtype=torch.long),
                    "attention_mask": torch.ones((1, 2), dtype=torch.long),
                }

        with TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "frame.jpg"
            Image.new("RGB", (100, 100), "white").save(image_path)
            model = SimpleNamespace(generate=Mock(return_value=(
                "<ref>person</ref><box><100><100><900><900></box>"
                "<conf>0.9</conf>"
            )))
            batch = SimpleNamespace(
                generate_batch_hybrid=Mock(
                    side_effect=AssertionError("hybrid executor should be bypassed")
                ),
            )
            provider = LocateAnythingGrounding(temp_dir)
            provider._loaded = True
            provider._model = model
            provider._processor = Processor()
            provider._tokenizer = object()
            provider._batch_utils = batch

            with patch.object(locate_anything, "DEVICE", "cpu"):
                boxes = provider.detect_objects(
                    str(image_path),
                    ["person"],
                    generation_mode="fast",
                    max_new_tokens=128,
                )

        self.assertEqual(len(boxes), 1)
        self.assertEqual(boxes[0]["className"], "person")
        model.generate.assert_called_once()
        self.assertEqual(
            model.generate.call_args.kwargs["generation_mode"],
            "fast",
        )
        self.assertEqual(
            model.generate.call_args.kwargs["max_new_tokens"],
            128,
        )
        batch.generate_batch_hybrid.assert_not_called()

    def test_tracker_declares_assignment_dependency_for_bytetrack(self) -> None:
        modules = registry.PROVIDER_SPECS["tracker"].modules
        self.assertEqual(
            "lap" in modules,
            registry.TRACKER_BACKEND == "bytetrack",
        )


class PipelineStatusTests(unittest.TestCase):
    def test_custom_grounding_categories_are_preserved_and_deduplicated(self) -> None:
        selected, mode = _select_grounding_categories(
            ["person", "Train", "train", "", "platform"],
            [],
            None,
        )

        self.assertEqual(mode, "custom")
        self.assertEqual(selected, ["person", "Train", "platform"])

    def test_adaptive_grounding_uses_detector_and_semantic_evidence(self) -> None:
        detections = [
            SimpleNamespace(detections=[
                {"className": "person"},
                {"className": "suitcase"},
            ]),
        ]
        semantic = SegmentSemantic(
            scene={},
            camera={},
            persons_attributes=[{
                "gender": "male",
                "ageGroup": "adult",
                "clothing": [{"type": "coat"}],
            }],
            objects_attributes=[
                {"name": "train"},
                {"name": "railway_tracks"},
            ],
            events=[],
        )

        with (
            patch.object(pipeline, "LOCATE_CATEGORY_MODE", "adaptive"),
            patch.object(pipeline, "LOCATE_ADAPTIVE_MAX_CATEGORIES", 12),
        ):
            selected, mode = _select_grounding_categories(
                None,
                detections,
                semantic,
            )

        self.assertEqual(mode, "adaptive")
        self.assertLessEqual(len(selected), 12)
        self.assertIn("person", selected)
        self.assertIn("suitcase", selected)
        self.assertIn("train", selected)
        self.assertIn("railway tracks", selected)
        self.assertIn("man", selected)
        self.assertIn("clothing", selected)

    def test_adaptive_grounding_falls_back_when_evidence_is_empty(self) -> None:
        with patch.object(pipeline, "LOCATE_CATEGORY_MODE", "adaptive"):
            selected, mode = _select_grounding_categories(None, [], None)

        self.assertEqual(mode, "full_fallback")
        self.assertEqual(selected, list(DEFAULT_GROUNDING_CATEGORIES))

    def test_full_grounding_mode_preserves_complete_default_list(self) -> None:
        with patch.object(pipeline, "LOCATE_CATEGORY_MODE", "full"):
            selected, mode = _select_grounding_categories(
                None,
                [SimpleNamespace(detections=[{"className": "person"}])],
                None,
            )

        self.assertEqual(mode, "full")
        self.assertEqual(selected, list(DEFAULT_GROUNDING_CATEGORIES))

    def test_enabled_tracker_failure_degrades_segment(self) -> None:
        enabled = {
            "yolo": True,
            "tracker": True,
            "locate_anything": False,
            "qwen_vl": True,
        }
        results = {
            "yolo": {"status": "completed"},
            "tracker": {"status": "failed", "error": "synthetic failure"},
            "locate_anything": {"status": "disabled"},
            "qwen_vl": {"status": "completed"},
        }

        self.assertEqual(_degraded_visual_providers(results, enabled), ["tracker"])

    def test_disabled_visual_provider_does_not_degrade_segment(self) -> None:
        enabled = {
            "yolo": False,
            "tracker": False,
            "locate_anything": False,
            "qwen_vl": False,
        }
        results = {
            provider_id: {"status": "disabled"}
            for provider_id in enabled
        }

        self.assertEqual(_degraded_visual_providers(results, enabled), [])

    def test_real_bytetrack_requests_low_confidence_detections(self) -> None:
        with (
            patch.object(pipeline, "TRACKER_BACKEND", "bytetrack"),
            patch.object(pipeline, "DEFAULT_TRACK_LOW_THRESHOLD", 0.1),
        ):
            confidence = _detector_confidence_for_tracking({
                "tracker": True,
            })

        self.assertEqual(confidence, 0.1)

    def test_iou_or_disabled_tracker_preserves_detector_default(self) -> None:
        with patch.object(pipeline, "TRACKER_BACKEND", "iou"):
            self.assertIsNone(_detector_confidence_for_tracking({
                "tracker": True,
            }))
        with patch.object(pipeline, "TRACKER_BACKEND", "bytetrack"):
            self.assertIsNone(_detector_confidence_for_tracking({
                "tracker": False,
            }))

    def test_tracker_without_detections_is_not_a_failure(self) -> None:
        enabled = {
            "yolo": True,
            "tracker": True,
            "locate_anything": False,
            "qwen_vl": True,
        }
        results = {
            "yolo": {"status": "completed"},
            "tracker": {"status": "skipped", "reason": "no_detections"},
            "locate_anything": {"status": "disabled"},
            "qwen_vl": {"status": "completed"},
        }

        self.assertEqual(_degraded_visual_providers(results, enabled), [])


class _FailingQwenProcessor:
    def apply_chat_template(self, *args, **kwargs) -> str:
        raise ValueError("synthetic processor failure")


class _InvalidQwenProcessor:
    def apply_chat_template(self, *args, **kwargs) -> str:
        return "synthetic prompt"

    def __call__(self, *args, **kwargs) -> dict:
        return {"input_ids": torch.tensor([[1, 2]])}

    def decode(self, *args, **kwargs) -> str:
        return "not valid json"


class _EmptyQwenProcessor(_InvalidQwenProcessor):
    def decode(self, *args, **kwargs) -> str:
        return "{}"


class _InvalidQwenModel:
    def generate(self, **kwargs):
        return torch.tensor([[1, 2, 3]])


class QwenFailurePropagationTests(unittest.TestCase):
    def test_inference_failure_is_not_returned_as_empty_success(self) -> None:
        provider = QwenVLSemantic()
        provider._loaded = True
        provider._processor = _FailingQwenProcessor()

        with TemporaryDirectory() as temp_dir:
            frame_path = Path(temp_dir) / "frame.jpg"
            Image.new("RGB", (8, 8), "white").save(frame_path)

            with self.assertRaisesRegex(
                RuntimeError,
                "Qwen3-VL semantic inference failed",
            ):
                provider.annotate_semantic(frame_paths=[str(frame_path)])

    def test_invalid_response_is_not_returned_as_empty_success(self) -> None:
        provider = QwenVLSemantic()
        provider._loaded = True
        provider._processor = _InvalidQwenProcessor()
        provider._model = _InvalidQwenModel()

        with TemporaryDirectory() as temp_dir:
            frame_path = Path(temp_dir) / "frame.jpg"
            Image.new("RGB", (8, 8), "white").save(frame_path)

            with (
                patch.object(qwen_vl, "DEVICE", "cpu"),
                self.assertRaisesRegex(
                    RuntimeError,
                    "empty or invalid semantic response",
                ),
            ):
                provider.annotate_semantic(frame_paths=[str(frame_path)])

    def test_empty_json_is_not_returned_as_default_success(self) -> None:
        provider = QwenVLSemantic()
        provider._loaded = True
        provider._processor = _EmptyQwenProcessor()
        provider._model = _InvalidQwenModel()

        with TemporaryDirectory() as temp_dir:
            frame_path = Path(temp_dir) / "frame.jpg"
            Image.new("RGB", (8, 8), "white").save(frame_path)

            with (
                patch.object(qwen_vl, "DEVICE", "cpu"),
                self.assertRaisesRegex(
                    RuntimeError,
                    "empty or invalid semantic response",
                ),
            ):
                provider.annotate_semantic(frame_paths=[str(frame_path)])


class _FakeYoloModel:
    def __init__(self) -> None:
        self.calls: list[dict[str, float | bool]] = []

    def __call__(self, _frame: np.ndarray, **kwargs):
        self.calls.append(kwargs)
        return []


class YoloThresholdTests(unittest.TestCase):
    def test_explicit_point_45_iou_is_preserved(self) -> None:
        detector = YOLO11Detector()
        fake_model = _FakeYoloModel()
        detector._model = fake_model

        detector.detect_frames([np.zeros((2, 2, 3), dtype=np.uint8)], iou=0.45)

        self.assertEqual(fake_model.calls[0]["iou"], 0.45)

    def test_none_uses_configured_defaults_and_zero_is_not_replaced(self) -> None:
        detector = YOLO11Detector()
        fake_model = _FakeYoloModel()
        detector._model = fake_model

        detector.detect_frames([np.zeros((2, 2, 3), dtype=np.uint8)])
        detector.detect_frames([np.zeros((2, 2, 3), dtype=np.uint8)], conf=0.0, iou=0.0)

        self.assertEqual(fake_model.calls[0]["conf"], DEFAULT_CONFIDENCE_THRESHOLD)
        self.assertEqual(fake_model.calls[0]["iou"], DEFAULT_IOU_THRESHOLD)
        self.assertEqual(fake_model.calls[1]["conf"], 0.0)
        self.assertEqual(fake_model.calls[1]["iou"], 0.0)


class _FakeRapidOcrEngine:
    def __call__(self, *_args, **_kwargs):
        return SimpleNamespace(
            txts=("却都牺牲了", "NUWA"),
            scores=(0.97, 0.88),
            boxes=np.array([
                [[100, 200], [300, 200], [300, 240], [100, 240]],
                [[10, 20], [90, 20], [90, 50], [10, 50]],
            ], dtype=np.float32),
        )


class RapidOcrProviderTests(unittest.TestCase):
    def test_detected_lines_keep_real_scores_and_pixel_boxes(self) -> None:
        provider = TrOCRProvider()
        provider._engine = _FakeRapidOcrEngine()
        provider._loaded = True

        result = provider.extract_text("unused.jpg")

        self.assertEqual(result[0]["text"], "却都牺牲了")
        self.assertEqual(result[0]["confidence"], 0.97)
        self.assertEqual(
            result[0]["bbox"],
            {"x": 100, "y": 200, "width": 200, "height": 40},
        )

    def test_inference_errors_are_not_disguised_as_no_text(self) -> None:
        provider = TrOCRProvider()
        provider._engine = lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad model"))
        provider._loaded = True

        with self.assertRaisesRegex(RuntimeError, "bad model"):
            provider.extract_text("unused.jpg")

    def test_duplicate_lines_across_keyframes_keep_highest_confidence(self) -> None:
        result = _deduplicate_ocr_texts([
            {"text": "却 都牺牲了", "confidence": 0.71, "bbox": {"x": 1}},
            {"text": "却都牺牲了", "confidence": 0.96, "bbox": {"x": 2}},
            {"text": "NUWA", "confidence": 0.82, "bbox": {"x": 3}},
        ])

        self.assertEqual([item["text"] for item in result], ["却都牺牲了", "NUWA"])
        self.assertEqual(result[0]["confidence"], 0.96)
        self.assertEqual(result[0]["bbox"], {"x": 2})


class RecognitionMergeTests(unittest.TestCase):
    def test_merge_preserves_per_frame_spatial_observations(self) -> None:
        tracks = [
            FrameTrack(0, [{
                "trackId": 4, "className": "person", "bbox": [1, 2, 30, 40],
                "detectionConfidence": 0.9, "trackingConfidence": 0.8,
            }]),
            FrameTrack(1, [{
                "trackId": 4, "className": "person", "bbox": [5, 6, 30, 40],
                "detectionConfidence": 0.88, "trackingConfidence": 0.8,
            }]),
        ]
        result = merge_results(
            tracks=tracks,
            fine_objects=[],
            semantic=None,
            depth_result=SimpleNamespace(objects_depths=[]),
            segment_start=10.0,
            tracking_fps=2.0,
            video_fps=24.0,
            video_width=640,
            video_height=360,
        )

        self.assertEqual([frame["frameIndex"] for frame in result["frames"]], [240, 252])
        self.assertEqual([frame["timestamp"] for frame in result["frames"]], [10.0, 10.5])
        self.assertEqual(result["frames"][1]["observations"][0]["bbox"]["x"], 5)
        self.assertEqual(result["frames"][0]["imageWidth"], 640)

    def test_ocr_box_is_attached_only_to_its_nearest_sampled_frame(self) -> None:
        tracks = [FrameTrack(0, []), FrameTrack(1, [])]
        result = merge_results(
            tracks=tracks,
            fine_objects=[],
            semantic=None,
            depth_result=SimpleNamespace(objects_depths=[]),
            ocr_texts=[{
                "text": "subtitle", "bbox": {"x": 10, "y": 20, "width": 100, "height": 20},
                "confidence": 0.95, "_timestamp": 10.5,
            }],
            segment_start=10.0,
            tracking_fps=2.0,
            video_fps=24.0,
        )

        self.assertEqual(result["frames"][0]["observations"], [])
        self.assertEqual(result["frames"][1]["observations"][0]["className"], "subtitle")
        self.assertEqual(result["frames"][1]["observations"][0]["entityType"], "object")
        self.assertEqual(result["frames"][1]["observations"][0]["trackId"], 1_000_000)

    def test_ocr_track_id_cannot_collide_with_a_detector_track(self) -> None:
        tracks = [FrameTrack(0, [{
            "trackId": 1_000_000,
            "className": "bird",
            "bbox": [10, 20, 30, 40],
            "detectionConfidence": 0.9,
            "trackingConfidence": 0.8,
        }])]
        result = merge_results(
            tracks=tracks,
            fine_objects=[],
            semantic=None,
            depth_result=SimpleNamespace(objects_depths=[]),
            ocr_texts=[{
                "text": "subtitle",
                "bbox": {"x": 100, "y": 200, "width": 200, "height": 40},
                "confidence": 0.97,
            }],
        )

        self.assertEqual(
            {obj["trackId"] for obj in result["objects"]},
            {1_000_000, 1_000_001},
        )
        self.assertEqual(
            {obs["trackId"] for obs in result["frames"][0]["observations"]},
            {1_000_000, 1_000_001},
        )

    def test_ocr_bbox_and_unscored_speech_remain_backward_compatible(self) -> None:
        recognition = {
            "ocr": {"status": "completed", "count": 1},
            "speech": {"status": "completed", "count": 1},
        }
        result = merge_results(
            tracks=[],
            fine_objects=[],
            semantic=None,
            depth_result=SimpleNamespace(objects_depths=[]),
            ocr_texts=[{
                "text": "却都牺牲了",
                "bbox": {"x": 100, "y": 200, "width": 200, "height": 40},
                "confidence": 0.97,
            }],
            transcript={"text": "And they died."},
            recognition_status=recognition,
        )

        self.assertEqual(result["objects"][0]["bbox"]["x"], 100)
        self.assertEqual(result["objects"][0]["_detectionConfidence"], 0.97)
        self.assertEqual(result["events"], [])
        self.assertEqual(result["speechTranscript"], "And they died.")
        self.assertEqual(result["_recognition"], recognition)


class SemanticEvidenceTests(unittest.TestCase):
    @staticmethod
    def _semantic(objects: list[dict], events: list[dict]) -> SegmentSemantic:
        return SegmentSemantic(
            scene={"tags": [], "place": {"type": "unknown"}},
            camera={"shot": "unknown", "angle": "unknown", "movement": []},
            persons_attributes=[],
            objects_attributes=objects,
            events=events,
        )

    def test_unlocalized_qwen_object_and_dependent_event_are_discarded(self) -> None:
        semantic = self._semantic(
            [{"trackId": 101, "name": "butterfly", "category": "animal"}],
            [{"type": "a man is looking at a butterfly", "confidence": 0.7}],
        )

        result = merge_results(
            tracks=[],
            fine_objects=[],
            semantic=semantic,
            depth_result=SimpleNamespace(objects_depths=[]),
        )

        self.assertEqual(result["objects"], [])
        self.assertEqual(result["events"], [])

    def test_detector_class_cannot_be_renamed_by_qwen_hallucination(self) -> None:
        tracks = [FrameTrack(0, [{
            "trackId": 7,
            "className": "bird",
            "bbox": [10, 20, 30, 40],
            "detectionConfidence": 0.92,
            "trackingConfidence": 0.9,
        }])]
        semantic = self._semantic(
            [{"trackId": 101, "name": "butterfly", "category": "animal", "color": "blue"}],
            [{"type": "a butterfly is resting on a flower", "confidence": 0.7}],
        )

        result = merge_results(
            tracks=tracks,
            fine_objects=[],
            semantic=semantic,
            depth_result=SimpleNamespace(objects_depths=[]),
        )

        self.assertEqual(result["objects"][0]["name"], "bird")
        self.assertIsNotNone(result["objects"][0]["bbox"])
        self.assertEqual(result["events"][0]["type"], "visual_activity")
        self.assertIn("bird", result["events"][0]["description"])
        self.assertNotIn("butterfly", result["events"][0]["description"])

    def test_person_attributes_bind_by_track_id_not_array_position(self) -> None:
        tracks = [FrameTrack(0, [
            {
                "trackId": 7, "className": "person", "bbox": [10, 20, 30, 40],
                "detectionConfidence": 0.9, "trackingConfidence": 0.9,
            },
            {
                "trackId": 2, "className": "person", "bbox": [60, 20, 30, 40],
                "detectionConfidence": 0.9, "trackingConfidence": 0.9,
            },
        ])]
        semantic = SegmentSemantic(
            scene={}, camera={}, objects_attributes=[], events=[],
            persons_attributes=[
                {"trackId": 2, "gender": "female", "action": ["reading"]},
                {"trackId": 7, "gender": "male", "action": ["standing"]},
            ],
        )

        result = merge_results(
            tracks=tracks,
            fine_objects=[],
            semantic=semantic,
            depth_result=SimpleNamespace(objects_depths=[]),
        )

        by_track = {person["trackId"]: person for person in result["persons"]}
        self.assertEqual(by_track[7]["gender"], "male")
        self.assertEqual(by_track[7]["action"], ["standing"])
        self.assertEqual(by_track[2]["gender"], "female")
        self.assertEqual(by_track[2]["action"], ["reading"])

    def test_unbound_person_attributes_do_not_fall_back_to_array_position(self) -> None:
        tracks = [FrameTrack(0, [{
            "trackId": 7, "className": "person", "bbox": [10, 20, 30, 40],
            "detectionConfidence": 0.9, "trackingConfidence": 0.9,
        }])]
        semantic = SegmentSemantic(
            scene={}, camera={}, objects_attributes=[], events=[],
            persons_attributes=[{"gender": "female", "action": ["reading"]}],
        )

        result = merge_results(
            tracks=tracks,
            fine_objects=[],
            semantic=semantic,
            depth_result=SimpleNamespace(objects_depths=[]),
        )

        self.assertEqual(result["persons"][0]["gender"], "unknown")
        self.assertEqual(result["persons"][0]["action"], [])

    def test_object_attributes_bind_only_to_matching_track_id(self) -> None:
        tracks = [FrameTrack(0, [
            {
                "trackId": 3, "className": "bird", "bbox": [10, 20, 30, 40],
                "detectionConfidence": 0.9, "trackingConfidence": 0.9,
            },
            {
                "trackId": 8, "className": "bird", "bbox": [60, 20, 30, 40],
                "detectionConfidence": 0.9, "trackingConfidence": 0.9,
            },
        ])]
        semantic = self._semantic(
            [
                {"trackId": 8, "name": "bird", "color": "white"},
                {"trackId": 3, "name": "bird", "color": "brown"},
            ],
            [],
        )

        result = merge_results(
            tracks=tracks,
            fine_objects=[],
            semantic=semantic,
            depth_result=SimpleNamespace(objects_depths=[]),
        )

        by_track = {item["trackId"]: item for item in result["objects"]}
        self.assertEqual(by_track[3]["color"], "brown")
        self.assertEqual(by_track[8]["color"], "white")


if __name__ == "__main__":
    unittest.main()
