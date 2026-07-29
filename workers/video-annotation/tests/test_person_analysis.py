from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from providers.semantic.base import SegmentSemantic
from services.person_analysis import (
    _crop_person,
    normalize_person_attributes,
    run_person_analysis,
)


class PersonAnalysisTests(unittest.TestCase):
    def test_normalization_keeps_only_editable_person_fields(self) -> None:
        normalized = normalize_person_attributes({
            "trackId": 99,
            "personId": "must-not-leak",
            "gender": "female",
            "action": ["standing", ""],
            "hair": {"color": "red"},
            "occlusion": 2,
            "clothing": [{"type": "jacket", "color": "pink", "attributes": ["heart"]}],
        })
        self.assertNotIn("trackId", normalized)
        self.assertNotIn("personId", normalized)
        self.assertEqual(normalized["gender"], "female")
        self.assertEqual(normalized["hair"], {"color": "red", "style": "unknown"})
        self.assertEqual(normalized["action"], ["standing"])
        self.assertEqual(normalized["occlusion"], 1.0)

    def test_crop_scales_review_coordinates_to_the_decoded_frame(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.jpg"
            output = Path(directory) / "crop.jpg"
            Image.new("RGB", (200, 100), color=(20, 30, 40)).save(source)
            _crop_person(
                str(source),
                str(output),
                {"x": 25, "y": 10, "width": 50, "height": 30},
                reference_width=100,
                reference_height=50,
            )
            with Image.open(output) as crop:
                self.assertGreater(crop.width, 100)
                self.assertGreater(crop.height, 60)
                self.assertLessEqual(crop.width, 200)
                self.assertLessEqual(crop.height, 100)

    def test_analysis_returns_preview_without_spatial_or_identity_fields(self) -> None:
        class DummyProvider:
            def load(self) -> None:
                pass

            def unload(self) -> None:
                pass

            def annotate_semantic(self, **_kwargs):
                return SegmentSemantic(
                    scene={},
                    camera={},
                    persons_attributes=[{
                        "trackId": 7,
                        "personId": "model-person",
                        "gender": "female",
                        "action": ["standing"],
                        "clothing": [],
                    }],
                    objects_attributes=[],
                    events=[],
                )

        with tempfile.TemporaryDirectory() as directory:
            frame = Path(directory) / "frame.jpg"
            Image.new("RGB", (100, 100), color=(200, 100, 100)).save(frame)
            with (
                patch("services.person_analysis.extract_keyframe", return_value=str(frame)),
                patch("services.person_analysis.semantic_inference_mode", return_value="local"),
                patch("services.person_analysis.create_provider", return_value=DummyProvider()),
                patch("services.person_analysis.mark_loaded"),
            ):
                result = run_person_analysis(
                    "video.mp4",
                    timestamp=1.25,
                    bbox={"x": 10, "y": 10, "width": 50, "height": 70},
                    image_width=100,
                    image_height=100,
                )
        self.assertEqual(result["source"], "local_qwen")
        self.assertEqual(result["timestamp"], 1.25)
        self.assertEqual(result["person"]["gender"], "female")
        self.assertNotIn("trackId", result["person"])
        self.assertNotIn("personId", result["person"])


if __name__ == "__main__":
    unittest.main()
