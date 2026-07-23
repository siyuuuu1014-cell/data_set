from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from providers.detector.base import FrameDetection
from providers.tracker.base import FrameTrack
from providers.tracker.bytetrack import ByteTrackTracker
from services.frame_sampling import extract_frames
from services.video_identity import assign_fallback_identities, assign_video_identities


def _frame(frame_index: int, *tracks: tuple[int, str, list[float]]) -> FrameTrack:
    return FrameTrack(
        frame_index,
        [
            {
                "trackId": track_id,
                "className": class_name,
                "bbox": bbox,
                "detectionConfidence": 0.9,
                "trackingConfidence": 0.9,
            }
            for track_id, class_name, bbox in tracks
        ],
    )


class TrackerAssociationTests(unittest.TestCase):
    def test_one_track_is_not_assigned_to_two_detections_in_same_frame(self) -> None:
        detections = [
            FrameDetection(0, [
                {"bbox": [0, 0, 100, 100], "className": "person", "confidence": 0.95},
            ]),
            FrameDetection(1, [
                {"bbox": [0, 0, 100, 100], "className": "person", "confidence": 0.95},
                {"bbox": [1, 1, 100, 100], "className": "person", "confidence": 0.90},
            ]),
        ]

        tracker = ByteTrackTracker(match_thresh=0.8)
        result = tracker.track(detections, "segment-1")

        second_frame_ids = [track["trackId"] for track in result[1].tracks]
        self.assertEqual(len(second_frame_ids), len(set(second_frame_ids)))
        self.assertEqual(second_frame_ids, [1, 2])


class VideoIdentityTests(unittest.TestCase):
    def test_adjacent_segments_reuse_only_one_to_one_boundary_matches(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "source.mp4"
            video_path.write_bytes(b"test-video")
            registry_root = root / "registry"

            first = [
                _frame(0, (1, "person", [0, 0, 100, 100]), (2, "person", [200, 0, 100, 100])),
                _frame(1, (1, "person", [10, 0, 100, 100]), (2, "person", [210, 0, 100, 100])),
            ]
            first_assignment = assign_video_identities(
                first,
                video_id="video-1",
                video_path=str(video_path),
                segment_id=1,
                segment_start=0.0,
                segment_end=5.0,
                registry_root=registry_root,
            )

            second = [
                _frame(0, (1, "person", [11, 0, 100, 100]), (2, "person", [211, 0, 100, 100])),
            ]
            second_assignment = assign_video_identities(
                second,
                video_id="video-1",
                video_path=str(video_path),
                segment_id=2,
                segment_start=5.0,
                segment_end=10.0,
                registry_root=registry_root,
            )

            self.assertEqual(first_assignment.track_ids, second_assignment.track_ids)
            self.assertEqual(len(second_assignment.track_ids), 2)
            self.assertEqual(len(set(second_assignment.person_ids.values())), 2)

    def test_same_segment_rerun_reuses_global_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "source.mp4"
            video_path.write_bytes(b"test-video")
            registry_root = root / "registry"

            original = [_frame(0, (1, "person", [0, 0, 50, 100]))]
            first_assignment = assign_video_identities(
                original,
                video_id="video-2",
                video_path=str(video_path),
                segment_id=7,
                segment_start=12.0,
                segment_end=14.0,
                registry_root=registry_root,
            )
            rerun = [_frame(0, (1, "person", [3, 0, 50, 100]))]
            second_assignment = assign_video_identities(
                rerun,
                video_id="video-2",
                video_path=str(video_path),
                segment_id=7,
                segment_start=12.0,
                segment_end=14.0,
                registry_root=registry_root,
            )

            self.assertEqual(first_assignment.track_ids, second_assignment.track_ids)
            self.assertEqual(first_assignment.person_ids, second_assignment.person_ids)

    def test_fallback_ids_are_unique_between_segments(self) -> None:
        first = [_frame(0, (1, "person", [0, 0, 10, 10]))]
        second = [_frame(0, (1, "person", [0, 0, 10, 10]))]

        first_assignment = assign_fallback_identities(
            first,
            video_id="video-3",
            video_path="missing.mp4",
            segment_id=1,
            segment_start=0.0,
        )
        second_assignment = assign_fallback_identities(
            second,
            video_id="video-3",
            video_path="missing.mp4",
            segment_id=2,
            segment_start=5.0,
        )

        self.assertTrue(first_assignment.track_ids.isdisjoint(second_assignment.track_ids))
        self.assertNotEqual(first_assignment.person_ids, second_assignment.person_ids)


class FrameExtractionErrorTests(unittest.TestCase):
    def test_string_stderr_is_preserved_and_temp_directory_is_removed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "generated-frames"
            error = subprocess.CalledProcessError(1, ["ffmpeg"], stderr="invalid video")
            with (
                patch("services.frame_sampling.tempfile.mkdtemp", return_value=str(output_dir)),
                patch("services.frame_sampling.subprocess.run", side_effect=error),
            ):
                with self.assertRaisesRegex(RuntimeError, "invalid video"):
                    extract_frames("broken.mp4", 0, 1)

            self.assertFalse(output_dir.exists())


if __name__ == "__main__":
    unittest.main()
