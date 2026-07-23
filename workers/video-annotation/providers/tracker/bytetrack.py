"""ByteTrack tracker provider."""

from __future__ import annotations

import logging

from config import DEVICE
from providers.detector.base import FrameDetection
from .base import FrameTrack

logger = logging.getLogger(__name__)


class ByteTrackTracker:
    """ByteTrack-based multi-object tracker.

    Uses the simple online tracking approach:
    - High-confidence detections → ByteTrack
    - Low-confidence detections → second association
    """

    def __init__(self, track_thresh: float = 0.5, match_thresh: float = 0.8) -> None:
        self._track_thresh = track_thresh
        self._match_thresh = match_thresh
        self._max_lost = 50  # ~100s @ 0.5fps — covers any single segment without accumulating noise
        self._next_id = 1
        self._active_tracks: dict[int, dict] = {}

    def load(self) -> None:
        logger.info("ByteTrack tracker initialized")

    def unload(self) -> None:
        self._active_tracks.clear()
        self._next_id = 1
        logger.info("ByteTrack tracker unloaded")

    def track(
        self,
        detections: list[FrameDetection],
        segment_id: str,
    ) -> list[FrameTrack]:
        """Simple IoU-based tracking.

        For production, replace with `boxmot` or `bytetrack` package.
        """
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
