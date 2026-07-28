from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np

from providers.reid.youtu_reid import YoutuPersonReID, _crop_person
from providers.tracker.base import FrameTrack


class YoutuPersonReIDTests(unittest.TestCase):
    def test_embed_tracks_aggregates_representative_person_crops(self) -> None:
        frames = [np.full((80, 60, 3), value, dtype=np.uint8) for value in (20, 40, 60)]
        tracks = [
            FrameTrack(index, [{
                "trackId": 7,
                "className": "person",
                "bbox": [10, 5, 30, 60],
                "detectionConfidence": 0.9,
            }])
            for index in range(3)
        ]
        provider = YoutuPersonReID("unused.onnx")
        provider._net = object()

        with patch.object(
            provider,
            "_infer",
            side_effect=[
                np.asarray([1.0, 0.0], dtype=np.float32),
                np.asarray([1.0, 0.0], dtype=np.float32),
                np.asarray([0.0, 1.0], dtype=np.float32),
            ],
        ):
            embeddings = provider.embed_tracks(frames, tracks)

        self.assertIn(7, embeddings)
        self.assertAlmostEqual(float(np.linalg.norm(embeddings[7])), 1.0, places=5)

    def test_invalid_or_tiny_person_crop_is_skipped(self) -> None:
        frame = np.zeros((20, 20, 3), dtype=np.uint8)
        self.assertIsNone(_crop_person(frame, [0, 0, 5, 8]))


if __name__ == "__main__":
    unittest.main()
