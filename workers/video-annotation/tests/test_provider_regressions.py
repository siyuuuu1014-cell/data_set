from __future__ import annotations

import unittest
from types import SimpleNamespace

import numpy as np

from config import DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_IOU_THRESHOLD
from pipeline import _deduplicate_ocr_texts
from providers.detector.yolo11 import YOLO11Detector
from providers.ocr.trocr import TrOCRProvider
from providers.semantic.base import SegmentSemantic
from providers.semantic.qwen_vl import PROMPT, _pick
from providers.tracker.base import FrameTrack
from services.merge_service import merge_results


class SemanticPickTests(unittest.TestCase):
    def test_prompt_does_not_seed_specific_object_hallucinations(self) -> None:
        self.assertNotIn("butterfly", PROMPT.lower())
        self.assertIn("never guess", PROMPT.lower())

    def test_female_does_not_match_male_substring(self) -> None:
        self.assertEqual(_pick("female", ["male", "female"], "unknown"), "female")
        self.assertEqual(_pick("female adult", ["male", "female"], "unknown"), "female")

    def test_age_aliases_preserve_short_qwen_outputs(self) -> None:
        aliases = {"young": "young adult", "middle": "middle aged"}
        options = ["child", "teen", "young adult", "middle aged", "elderly"]
        self.assertEqual(_pick("young", options, "unknown", aliases=aliases), "young adult")
        self.assertEqual(_pick("middle", options, "unknown", aliases=aliases), "middle aged")


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
        self.assertEqual(result["events"][0]["confidence"], 0.0)
        self.assertFalse(result["events"][0]["_confidenceAvailable"])
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
        self.assertEqual(result["events"], [])


if __name__ == "__main__":
    unittest.main()
