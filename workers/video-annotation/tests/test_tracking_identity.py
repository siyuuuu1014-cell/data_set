from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline import _extend_detection_batch
from providers.detector.base import FrameDetection
from providers.tracker.base import FrameTrack
from providers.tracker.bytetrack import ByteTrackTracker
from services.frame_sampling import extract_frames, extract_segment_keyframes
from services.video_identity import (
    _can_alias,
    _load_state,
    _match_existing_segment,
    assign_fallback_identities,
    assign_video_identities,
)


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

        tracker = ByteTrackTracker(match_thresh=0.8, backend="iou")
        result = tracker.track(detections, "segment-1")

        second_frame_ids = [track["trackId"] for track in result[1].tracks]
        self.assertEqual(len(second_frame_ids), len(set(second_frame_ids)))
        self.assertEqual(second_frame_ids, [1, 2])

    def test_detection_batch_indexes_are_owned_by_pipeline(self) -> None:
        target: list[FrameDetection] = []
        batch = [FrameDetection(20, []), FrameDetection(21, [])]

        _extend_detection_batch(target, batch, offset=4, expected_count=2)

        self.assertEqual([frame.frame_index for frame in target], [4, 5])

    def test_detection_batch_mismatch_is_gracefully_skipped(self) -> None:
        """An inconsistent batch warns and continues without discarding previous batches."""
        target: list[FrameDetection] = [FrameDetection(0, [])]
        _extend_detection_batch(
            target, [FrameDetection(1, [])], offset=1, expected_count=2,
        )
        # The mismatched batch was skipped; the target retains only the previous item.
        self.assertEqual(len(target), 1)
        self.assertEqual(target[0].frame_index, 0)


class ByteTrackBackendTests(unittest.TestCase):
    def test_low_confidence_detection_cannot_start_a_track(self) -> None:
        tracker = ByteTrackTracker(
            track_thresh=0.65,
            low_thresh=0.1,
            backend="bytetrack",
        )
        result = tracker.track([
            FrameDetection(0, [{
                "bbox": [0, 0, 100, 100],
                "className": "person",
                "confidence": 0.3,
            }]),
        ], "segment-1")

        self.assertEqual(result[0].tracks, [])

    def test_low_confidence_detection_keeps_confirmed_track_alive(self) -> None:
        tracker = ByteTrackTracker(
            track_thresh=0.65,
            low_thresh=0.1,
            backend="bytetrack",
        )
        result = tracker.track([
            FrameDetection(0, [{
                "bbox": [0, 0, 100, 100],
                "className": "person",
                "confidence": 0.95,
            }]),
            FrameDetection(1, [{
                "bbox": [2, 0, 100, 100],
                "className": "person",
                "confidence": 0.3,
            }]),
        ], "segment-1")

        self.assertEqual(len(result[0].tracks), 1)
        self.assertEqual(len(result[1].tracks), 1)
        self.assertEqual(
            result[0].tracks[0]["trackId"],
            result[1].tracks[0]["trackId"],
        )

    def test_first_high_confidence_appearance_starts_track_after_empty_frame(self) -> None:
        tracker = ByteTrackTracker(backend="bytetrack")
        result = tracker.track([
            FrameDetection(0, []),
            FrameDetection(1, [{
                "bbox": [0, 0, 100, 100],
                "className": "person",
                "confidence": 0.95,
            }]),
        ], "segment-1")

        self.assertEqual(result[0].tracks, [])
        self.assertEqual(len(result[1].tracks), 1)

    def test_different_classes_never_share_exported_track_id(self) -> None:
        tracker = ByteTrackTracker(backend="bytetrack")
        result = tracker.track([
            FrameDetection(0, [
                {
                    "bbox": [0, 0, 100, 100],
                    "className": "person",
                    "confidence": 0.95,
                },
                {
                    "bbox": [0, 0, 100, 100],
                    "className": "dog",
                    "confidence": 0.95,
                },
            ]),
        ], "segment-1")

        ids = [track["trackId"] for track in result[0].tracks]
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(set(ids)), 2)


class VideoIdentityTests(unittest.TestCase):
    def test_v1_registry_is_migrated_without_changing_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            path.write_text(json.dumps({
                "version": 1,
                "videoId": "video-v1",
                "videoFingerprint": {
                    "path": "source.mp4",
                    "size": 10,
                    "modifiedNs": 20,
                    "identitySchema": 1,
                },
                "nextTrackId": 8,
                "segments": {
                    "id:1": {
                        "start": 0.0,
                        "end": 5.0,
                        "localToGlobal": {"1": 7},
                        "tracks": {
                            "7": {
                                "className": "person",
                                "firstBBox": [0, 0, 10, 20],
                                "lastBBox": [1, 0, 10, 20],
                            },
                        },
                    },
                },
            }), encoding="utf-8")

            migrated = _load_state(path)

            self.assertEqual(migrated["version"], 2)
            self.assertEqual(migrated["videoFingerprint"]["identitySchema"], 2)
            self.assertEqual(migrated["nextTrackId"], 8)
            self.assertEqual(migrated["segments"]["id:1"]["localToGlobal"], {"1": 7})
            self.assertEqual(
                migrated["segments"]["id:1"]["tracks"]["7"]["observationCount"],
                1,
            )
            self.assertEqual(migrated["aliases"], {})

    def test_v1_registry_survives_the_next_identity_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "source.mp4"
            video_path.write_bytes(b"legacy-video")
            registry_root = root / "registry"
            registry_root.mkdir()
            video_id = "video-v1-integration"
            registry_name = hashlib.sha256(video_id.encode("utf-8")).hexdigest()[:24] + ".json"
            registry_path = registry_root / registry_name
            stat = video_path.stat()
            registry_path.write_text(json.dumps({
                "version": 1,
                "videoId": video_id,
                "videoFingerprint": {
                    "path": str(video_path.resolve()),
                    "size": stat.st_size,
                    "modifiedNs": stat.st_mtime_ns,
                    "identitySchema": 1,
                },
                "nextTrackId": 8,
                "segments": {
                    "id:1": {
                        "start": 0.0,
                        "end": 5.0,
                        "localToGlobal": {"1": 7},
                        "tracks": {
                            "7": {
                                "className": "person",
                                "firstBBox": [0, 0, 10, 20],
                                "lastBBox": [0, 0, 10, 20],
                            },
                        },
                    },
                },
            }), encoding="utf-8")

            assignment = assign_video_identities(
                [_frame(0, (1, "person", [1, 0, 10, 20]))],
                video_id=video_id,
                video_path=str(video_path),
                segment_id=1,
                segment_start=0.0,
                segment_end=5.0,
                registry_root=registry_root,
            )
            persisted = json.loads(registry_path.read_text(encoding="utf-8"))

            self.assertEqual(assignment.track_ids, frozenset({7}))
            self.assertEqual(persisted["version"], 2)
            self.assertEqual(persisted["segments"]["id:1"]["localToGlobal"], {"1": 7})
            self.assertEqual(persisted["nextTrackId"], 8)

    def test_same_segment_stored_mapping_precedes_positional_greedy_match(self) -> None:
        existing = {
            "localToGlobal": {"1": 101, "2": 102},
            "tracks": {
                "101": {
                    "className": "person",
                    "firstBBox": [0, 0, 100, 100],
                    "lastBBox": [0, 0, 100, 100],
                },
                "102": {
                    "className": "person",
                    "firstBBox": [60, 0, 100, 100],
                    "lastBBox": [60, 0, 100, 100],
                },
            },
        }
        summaries = {
            1: {
                "className": "person",
                "firstBBox": [60, 0, 100, 100],
                "lastBBox": [60, 0, 100, 100],
            },
            2: {
                "className": "person",
                "firstBBox": [0, 0, 100, 100],
                "lastBBox": [0, 0, 100, 100],
            },
        }

        self.assertEqual(_match_existing_segment(existing, summaries, {}), {1: 101, 2: 102})

    def test_same_segment_reid_conflict_can_reject_stale_local_mapping(self) -> None:
        existing = {
            "localToGlobal": {"1": 101, "2": 102},
            "tracks": {
                "101": {
                    "className": "person",
                    "firstBBox": [0, 0, 100, 100],
                    "lastBBox": [0, 0, 100, 100],
                    "embedding": [1.0, 0.0],
                },
                "102": {
                    "className": "person",
                    "firstBBox": [60, 0, 100, 100],
                    "lastBBox": [60, 0, 100, 100],
                    "embedding": [0.0, 1.0],
                },
            },
        }
        summaries = {
            1: {
                "className": "person",
                "firstBBox": [60, 0, 100, 100],
                "lastBBox": [60, 0, 100, 100],
                "embedding": [0.0, 1.0],
            },
            2: {
                "className": "person",
                "firstBBox": [0, 0, 100, 100],
                "lastBBox": [0, 0, 100, 100],
                "embedding": [1.0, 0.0],
            },
        }

        self.assertEqual(_match_existing_segment(existing, summaries, {}), {1: 102, 2: 101})

        # An inconclusive score below the positive-match threshold is not a
        # hard conflict: strong positional evidence may still preserve recall.
        ambiguous_existing = {
            "localToGlobal": {},
            "tracks": {
                "101": {
                    "className": "person",
                    "firstBBox": [0, 0, 100, 100],
                    "lastBBox": [0, 0, 100, 100],
                    "embedding": [1.0, 0.0],
                },
            },
        }
        ambiguous_summary = {
            9: {
                "className": "person",
                "firstBBox": [0, 0, 100, 100],
                "lastBBox": [0, 0, 100, 100],
                "embedding": [0.7, 0.714142842854285],
            },
        }
        self.assertEqual(
            _match_existing_segment(ambiguous_existing, ambiguous_summary, {}),
            {9: 101},
        )

    def test_person_alias_requires_compatible_historical_appearance(self) -> None:
        state = {
            "segments": {
                "id:1": {
                    "localToGlobal": {"1": 101},
                    "tracks": {"101": {"className": "person", "embedding": [1.0, 0.0]}},
                },
                "id:2": {
                    "localToGlobal": {"1": 102},
                    "tracks": {"102": {"className": "person", "embedding": [0.0, 1.0]}},
                },
            },
        }

        self.assertFalse(_can_alias(state, 101, 102))

        state["segments"]["id:2"]["tracks"]["102"]["embedding"] = [0.99, 0.01]
        self.assertTrue(_can_alias(state, 101, 102))

    def test_person_alias_without_appearance_evidence_is_rejected(self) -> None:
        state = {
            "segments": {
                "id:1": {
                    "localToGlobal": {"1": 101},
                    "tracks": {"101": {"className": "person"}},
                },
                "id:2": {
                    "localToGlobal": {"1": 102},
                    "tracks": {"102": {"className": "person"}},
                },
            },
        }

        self.assertFalse(_can_alias(state, 101, 102))

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

    def test_reid_reconnects_a_person_when_boundary_boxes_do_not_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "source.mp4"
            video_path.write_bytes(b"test-video")
            registry_root = root / "registry"

            first = assign_video_identities(
                [_frame(0, (1, "person", [0, 0, 60, 120]))],
                video_id="video-reid",
                video_path=str(video_path),
                segment_id=1,
                segment_start=0,
                segment_end=5,
                track_embeddings={1: [1.0, 0.0, 0.0]},
                registry_root=registry_root,
            )
            second = assign_video_identities(
                [_frame(0, (9, "person", [500, 100, 60, 120]))],
                video_id="video-reid",
                video_path=str(video_path),
                segment_id=2,
                segment_start=5,
                segment_end=10,
                track_embeddings={9: [0.99, 0.01, 0.0]},
                registry_root=registry_root,
            )

            self.assertEqual(set(first.person_ids.values()), set(second.person_ids.values()))

    def test_reid_keeps_visually_different_people_separate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "source.mp4"
            video_path.write_bytes(b"test-video")
            registry_root = root / "registry"

            first = assign_video_identities(
                [_frame(0, (1, "person", [0, 0, 60, 120]))],
                video_id="video-different",
                video_path=str(video_path),
                segment_id=1,
                segment_start=0,
                segment_end=5,
                track_embeddings={1: [1.0, 0.0, 0.0]},
                registry_root=registry_root,
            )
            second = assign_video_identities(
                [_frame(0, (1, "person", [500, 100, 60, 120]))],
                video_id="video-different",
                video_path=str(video_path),
                segment_id=2,
                segment_start=5,
                segment_end=10,
                track_embeddings={1: [0.0, 1.0, 0.0]},
                registry_root=registry_root,
            )

            self.assertTrue(first.track_ids.isdisjoint(second.track_ids))

    def test_out_of_order_middle_segment_reconciles_both_directions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "source.mp4"
            video_path.write_bytes(b"test-video")
            registry_root = root / "registry"
            embedding = {1: [1.0, 0.0, 0.0]}

            first = assign_video_identities(
                [_frame(0, (1, "person", [0, 0, 60, 120]))],
                video_id="video-bridge",
                video_path=str(video_path),
                segment_id=1,
                segment_start=0,
                segment_end=1,
                track_embeddings=embedding,
                registry_root=registry_root,
            )
            third = assign_video_identities(
                [_frame(0, (1, "person", [400, 0, 60, 120]))],
                video_id="video-bridge",
                video_path=str(video_path),
                segment_id=3,
                segment_start=50,
                segment_end=51,
                track_embeddings=embedding,
                registry_root=registry_root,
            )
            self.assertTrue(first.track_ids.isdisjoint(third.track_ids))

            middle = assign_video_identities(
                [_frame(0, (1, "person", [200, 0, 60, 120]))],
                video_id="video-bridge",
                video_path=str(video_path),
                segment_id=2,
                segment_start=25,
                segment_end=26,
                track_embeddings=embedding,
                registry_root=registry_root,
            )

            self.assertTrue(middle.aliases)
            self.assertEqual(set(first.track_ids), set(middle.track_ids))

    def test_out_of_order_iou_fallback_uses_the_correct_segment_boundaries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "source.mp4"
            video_path.write_bytes(b"test-video")
            registry_root = root / "registry"

            later = assign_video_identities(
                [_frame(0, (3, "person", [100, 0, 60, 120]))],
                video_id="video-reverse-iou",
                video_path=str(video_path),
                segment_id=2,
                segment_start=5,
                segment_end=10,
                registry_root=registry_root,
            )
            earlier = assign_video_identities(
                [
                    _frame(0, (8, "person", [0, 0, 60, 120])),
                    _frame(1, (8, "person", [100, 0, 60, 120])),
                ],
                video_id="video-reverse-iou",
                video_path=str(video_path),
                segment_id=1,
                segment_start=0,
                segment_end=5,
                registry_root=registry_root,
            )

            self.assertEqual(later.track_ids, earlier.track_ids)


class FrameExtractionErrorTests(unittest.TestCase):
    def test_keyframe_failure_retries_at_segment_midpoint_with_valid_seek_option(self) -> None:
        calls: list[list[str]] = []

        def fake_run(command: list[str], **_kwargs) -> None:
            calls.append(list(command))
            if len(calls) == 1:
                raise subprocess.CalledProcessError(1, command)

        with tempfile.TemporaryDirectory() as temp_dir, patch(
            "services.frame_sampling.subprocess.run",
            side_effect=fake_run,
        ):
            extract_segment_keyframes(
                "video.mp4",
                480.0,
                490.0,
                num_keyframes=1,
                output_dir=temp_dir,
                duration=490.0,
            )

        self.assertEqual(calls[0][1:3], ["-ss", "480.0"])
        self.assertEqual(calls[1][1:3], ["-ss", "485.0"])

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
