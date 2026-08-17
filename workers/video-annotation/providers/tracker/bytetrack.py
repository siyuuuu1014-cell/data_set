"""Configurable ByteTrack provider with the legacy IoU tracker as a fallback."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any

import numpy as np

from config import (
    DEFAULT_TRACK_BUFFER,
    DEFAULT_TRACK_HIGH_THRESHOLD,
    DEFAULT_TRACK_LOW_THRESHOLD,
    DEFAULT_TRACK_MATCH_THRESHOLD,
    TRACKER_BACKEND,
)
from providers.detector.base import FrameDetection
from .base import FrameTrack

logger = logging.getLogger(__name__)


class _DetectionBatch:
    """Minimal Ultralytics Results-compatible detection container."""

    def __init__(self, detections: list[dict]) -> None:
        self.xywh = np.asarray([
            [
                float(det["bbox"][0]) + float(det["bbox"][2]) / 2,
                float(det["bbox"][1]) + float(det["bbox"][3]) / 2,
                float(det["bbox"][2]),
                float(det["bbox"][3]),
            ]
            for det in detections
        ], dtype=np.float32).reshape((-1, 4))
        self.conf = np.asarray(
            [float(det["confidence"]) for det in detections],
            dtype=np.float32,
        )
        # One ByteTrack instance is maintained per class, so a local class ID is
        # sufficient and prevents cross-class association.
        self.cls = np.zeros(len(detections), dtype=np.float32)

    def __len__(self) -> int:
        return len(self.conf)

    def __getitem__(self, item: Any) -> "_DetectionBatch":
        selected = object.__new__(_DetectionBatch)
        selected.xywh = self.xywh[item].reshape((-1, 4))
        selected.conf = self.conf[item].reshape((-1,))
        selected.cls = self.cls[item].reshape((-1,))
        return selected


class ByteTrackTracker:
    """Associate frame detections using ByteTrack or the legacy IoU backend."""

    def __init__(
        self,
        track_thresh: float | None = None,
        match_thresh: float | None = None,
        *,
        low_thresh: float | None = None,
        track_buffer: int | None = None,
        backend: str | None = None,
    ) -> None:
        self._backend = (backend or TRACKER_BACKEND).strip().lower()
        if self._backend not in {"bytetrack", "iou"}:
            raise ValueError(
                "NUWA_TRACKER_BACKEND must be 'bytetrack' or 'iou'"
            )
        configured_track_thresh = (
            DEFAULT_TRACK_HIGH_THRESHOLD
            if track_thresh is None
            else track_thresh
        )
        self._track_thresh = min(1.0, max(0.0, configured_track_thresh))
        configured_low_thresh = (
            DEFAULT_TRACK_LOW_THRESHOLD
            if low_thresh is None
            else low_thresh
        )
        self._low_thresh = min(
            self._track_thresh,
            max(0.0, configured_low_thresh),
        )
        configured_match_thresh = (
            DEFAULT_TRACK_MATCH_THRESHOLD
            if match_thresh is None
            else match_thresh
        )
        self._match_thresh = min(1.0, max(0.0, configured_match_thresh))
        self._track_buffer = (
            DEFAULT_TRACK_BUFFER
            if track_buffer is None
            else max(1, track_buffer)
        )
        self._max_lost = self._track_buffer
        self._next_id = 1
        self._active_tracks: dict[int, dict] = {}
        self._byte_tracker_class: Any = None
        self._class_trackers: dict[str, Any] = {}
        self._global_track_ids: dict[tuple[str, int], int] = {}

    def load(self) -> None:
        if self._backend == "bytetrack":
            from ultralytics.trackers.byte_tracker import BYTETracker
            self._byte_tracker_class = BYTETracker
            logger.info(
                "ByteTrack initialized (high=%.2f, low=%.2f, match=%.2f)",
                self._track_thresh,
                self._low_thresh,
                self._match_thresh,
            )
        else:
            logger.info("Legacy IoU tracker initialized")

    def unload(self) -> None:
        self._active_tracks.clear()
        self._class_trackers.clear()
        self._global_track_ids.clear()
        self._byte_tracker_class = None
        self._next_id = 1
        logger.info("%s tracker unloaded", self._backend)

    def track(
        self,
        detections: list[FrameDetection],
        segment_id: str,
    ) -> list[FrameTrack]:
        """Associate detections while preserving the existing FrameTrack API."""
        del segment_id
        if self._backend == "bytetrack":
            return self._track_with_bytetrack(detections)
        return self._track_with_iou(detections)

    def _track_with_bytetrack(
        self,
        detections: list[FrameDetection],
    ) -> list[FrameTrack]:
        if self._byte_tracker_class is None:
            self.load()

        self._class_trackers.clear()
        self._global_track_ids.clear()
        self._next_id = 1
        results: list[FrameTrack] = []

        # Ultralytics uses one process-wide internal ID counter. Construct every
        # per-class tracker before processing the first frame so a later class
        # cannot reset that counter and collide with an existing track.
        class_names = list(dict.fromkeys(
            detection["className"]
            for frame in detections
            for detection in frame.detections
        ))
        tracker_args = SimpleNamespace(
            track_high_thresh=self._track_thresh,
            track_low_thresh=self._low_thresh,
            new_track_thresh=self._track_thresh,
            track_buffer=self._track_buffer,
            match_thresh=self._match_thresh,
            fuse_score=True,
        )
        self._class_trackers = {
            class_name: self._byte_tracker_class(tracker_args)
            for class_name in class_names
        }
        started_classes: set[str] = set()

        for frame in detections:
            grouped: dict[str, list[dict]] = {}
            for detection in frame.detections:
                grouped.setdefault(detection["className"], []).append(detection)

            frame_tracks: list[dict] = []
            for class_name in class_names:
                class_detections = grouped.get(class_name, [])
                tracker = self._class_trackers[class_name]
                if class_name not in started_classes:
                    has_confirmed_detection = any(
                        float(item["confidence"]) >= self._track_thresh
                        for item in class_detections
                    )
                    if not has_confirmed_detection:
                        continue
                    started_classes.add(class_name)
                output = tracker.update(_DetectionBatch(class_detections))
                for row in output:
                    local_track_id = int(row[4])
                    global_key = (class_name, local_track_id)
                    track_id = self._global_track_ids.get(global_key)
                    if track_id is None:
                        track_id = self._next_id
                        self._next_id += 1
                        self._global_track_ids[global_key] = track_id

                    score = min(1.0, max(0.0, float(row[5])))
                    frame_tracks.append({
                        "trackId": track_id,
                        "className": class_name,
                        "bbox": [
                            float(row[0]),
                            float(row[1]),
                            max(0.0, float(row[2] - row[0])),
                            max(0.0, float(row[3] - row[1])),
                        ],
                        "detectionConfidence": score,
                        "trackingConfidence": score,
                    })

            results.append(
                FrameTrack(frame_index=frame.frame_index, tracks=frame_tracks)
            )

        return results

    def _track_with_iou(
        self,
        detections: list[FrameDetection],
    ) -> list[FrameTrack]:
        """Legacy deterministic class-aware IoU association."""
        results: list[FrameTrack] = []
        self._active_tracks.clear()
        self._next_id = 1

        for fd in detections:
            frame_tracks: list[dict] = []
            # A track may be associated with at most one detection in a frame.
            # Without this guard, two nearby people can receive the same ID.
            matched_track_ids: set[int] = set()

            for det in fd.detections:
                bbox = det["bbox"]  # [x, y, w, h]
                best_iou = 0.0
                best_track_id: int | None = None

                # Match to existing tracks by IoU
                for tid, track in self._active_tracks.items():
                    if tid in matched_track_ids:
                        continue
                    if track["className"] != det["className"]:
                        continue
                    iou = self._compute_iou(bbox, track["bbox"])
                    if iou > best_iou and iou >= self._match_thresh:
                        best_iou = iou
                        best_track_id = tid

                if best_track_id is not None:
                    track_id = best_track_id
                    self._active_tracks[track_id]["bbox"] = bbox
                    self._active_tracks[track_id]["lost_frames"] = 0
                else:
                    # New track
                    track_id = self._next_id
                    self._next_id += 1
                    self._active_tracks[track_id] = {
                        "bbox": bbox,
                        "className": det["className"],
                        "lost_frames": 0,
                    }

                matched_track_ids.add(track_id)

                frame_tracks.append({
                    "trackId": track_id,
                    "className": det["className"],
                    "bbox": bbox,
                    "detectionConfidence": det["confidence"],
                    "trackingConfidence": 1.0 if best_iou > 0.5 else 0.5,
                })

            # Age tracks — remove ones not seen for > 10 frames
            stale: list[int] = []
            for tid, t in self._active_tracks.items():
                t["lost_frames"] += 1
                if t["lost_frames"] > self._max_lost:
                    stale.append(tid)
            for tid in stale:
                del self._active_tracks[tid]

            results.append(FrameTrack(frame_index=fd.frame_index, tracks=frame_tracks))

        return results

    @staticmethod
    def _compute_iou(bbox_a: list[float], bbox_b: list[float]) -> float:
        """Compute IoU between two [x, y, w, h] boxes."""
        ax1, ay1, aw, ah = bbox_a
        ax2, ay2 = ax1 + aw, ay1 + ah
        bx1, by1, bw, bh = bbox_b
        bx2, by2 = bx1 + bw, by1 + bh

        ix1 = max(ax1, bx1)
        iy1 = max(ay1, by1)
        ix2 = min(ax2, bx2)
        iy2 = min(ay2, by2)

        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0

        inter = (ix2 - ix1) * (iy2 - iy1)
        area_a = aw * ah
        area_b = bw * bh
        return inter / (area_a + area_b - inter)
