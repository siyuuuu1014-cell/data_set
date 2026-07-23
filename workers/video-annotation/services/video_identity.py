"""Video-scoped track and person identity assignment.

The detector/tracker runs once per annotation segment to keep GPU usage bounded.
This module stitches only high-confidence, temporally adjacent boundary tracks
and persists the ID allocator per video.  Ambiguous tracks receive new IDs;
false splits are safer than merging two different people.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from config import CACHE_DIR

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = 1
_MAX_STITCH_GAP_SECONDS = 2.5
_MIN_STITCH_IOU = 0.65
_thread_lock = threading.RLock()


@dataclass(frozen=True)
class IdentityAssignment:
    """Identity data for the globally remapped tracks in one segment."""

    track_ids: frozenset[int]
    person_ids: dict[int, str]


def assign_video_identities(
    tracks: list,
    *,
    video_id: str,
    video_path: str,
    segment_id: int | str | None,
    segment_start: float,
    segment_end: float,
    registry_root: Path | None = None,
) -> IdentityAssignment:
    """Remap local tracker IDs to stable video-scoped IDs in place.

    Existing mappings are reused when the same segment is annotated again.
    A track from the immediately preceding segment is reused only when class,
    timing, and boundary IoU all agree.  All other tracks get fresh IDs.
    """
    summaries = _summarize_tracks(tracks)
    if not summaries:
        return IdentityAssignment(frozenset(), {})

    normalized_video_id = _normalize_video_id(video_id, video_path)
    segment_key = _segment_key(segment_id, segment_start, segment_end)
    root = registry_root or (CACHE_DIR / "video-identities")
    root.mkdir(parents=True, exist_ok=True)
    registry_path = root / f"{hashlib.sha256(normalized_video_id.encode('utf-8')).hexdigest()[:24]}.json"
    lock_path = registry_path.with_suffix(".lock")

    with _thread_lock, _exclusive_file_lock(lock_path):
        fingerprint = _video_fingerprint(video_path)
        state = _load_state(registry_path)
        if state.get("videoFingerprint") != fingerprint:
            state = _new_state(normalized_video_id, fingerprint)

        segments = state.setdefault("segments", {})
        existing = segments.get(segment_key)
        mapping = _reuse_existing_mapping(existing, summaries)

        previous = _find_previous_segment(
            segments,
            current_key=segment_key,
            segment_start=segment_start,
        )
        if previous:
            _stitch_previous_tracks(mapping, summaries, previous)

        next_track_id = max(1, int(state.get("nextTrackId", 1)))
        reserved_ids = {
            int(global_id)
            for record in segments.values()
            for global_id in (record.get("localToGlobal", {}) or {}).values()
        }
        reserved_ids.update(mapping.values())

        for local_id in sorted(summaries):
            if local_id in mapping:
                continue
            while next_track_id in reserved_ids:
                next_track_id += 1
            mapping[local_id] = next_track_id
            reserved_ids.add(next_track_id)
            next_track_id += 1

        state["nextTrackId"] = next_track_id
        segments[segment_key] = _segment_record(
            segment_start,
            segment_end,
            summaries,
            mapping,
        )
        _write_state(registry_path, state)

    for frame_track in tracks:
        for track in frame_track.tracks:
            local_id = int(track["trackId"])
            track["trackId"] = mapping[local_id]

    person_ids = {
        mapping[local_id]: f"{normalized_video_id}:person:{mapping[local_id]}"
        for local_id, summary in summaries.items()
        if summary["className"] == "person"
    }
    return IdentityAssignment(frozenset(mapping.values()), person_ids)


def assign_fallback_identities(
    tracks: list,
    *,
    video_id: str,
    video_path: str,
    segment_id: int | str | None,
    segment_start: float,
) -> IdentityAssignment:
    """Deterministic no-I/O fallback used if the identity registry is unavailable."""
    normalized_video_id = _normalize_video_id(video_id, video_path)
    try:
        numeric_segment = int(segment_id) if segment_id is not None else 0
    except (TypeError, ValueError):
        numeric_segment = 0
    if numeric_segment <= 0:
        numeric_segment = int(round(max(0.0, segment_start) * 1000)) + 1

    mapping: dict[int, int] = {}
    for frame_track in tracks:
        for track in frame_track.tracks:
            local_id = int(track["trackId"])
            if local_id >= 100_000:
                raise ValueError("Local track ID exceeds fallback namespace")
            mapping.setdefault(local_id, numeric_segment * 100_000 + local_id)
            track["trackId"] = mapping[local_id]

    person_ids = {
        int(track["trackId"]): f"{normalized_video_id}:person:{int(track['trackId'])}"
        for frame_track in tracks
        for track in frame_track.tracks
        if track.get("className") == "person"
    }
    return IdentityAssignment(frozenset(mapping.values()), person_ids)


def _summarize_tracks(tracks: list) -> dict[int, dict]:
    summaries: dict[int, dict] = {}
    for frame_track in tracks:
        for track in frame_track.tracks:
            local_id = int(track["trackId"])
            bbox = [float(value) for value in track["bbox"]]
            summary = summaries.setdefault(
                local_id,
                {
                    "className": str(track.get("className", "unknown")),
                    "firstBBox": bbox,
                    "lastBBox": bbox,
                },
            )
            summary["lastBBox"] = bbox
    return summaries


def _reuse_existing_mapping(existing: dict | None, summaries: dict[int, dict]) -> dict[int, int]:
    if not existing:
        return {}
    stored = existing.get("localToGlobal", {}) or {}
    mapping: dict[int, int] = {}
    used_global_ids: set[int] = set()
    for local_id in summaries:
        global_id = stored.get(str(local_id), stored.get(local_id))
        if global_id is None:
            continue
        normalized_global_id = int(global_id)
        if normalized_global_id <= 0 or normalized_global_id in used_global_ids:
            continue
        mapping[local_id] = normalized_global_id
        used_global_ids.add(normalized_global_id)
    return mapping


def _find_previous_segment(
    segments: dict,
    *,
    current_key: str,
    segment_start: float,
) -> dict | None:
    candidates: list[tuple[float, dict]] = []
    for key, record in segments.items():
        if key == current_key:
            continue
        try:
            previous_end = float(record["end"])
        except (KeyError, TypeError, ValueError):
            continue
        gap = segment_start - previous_end
        if -0.05 <= gap <= _MAX_STITCH_GAP_SECONDS:
            candidates.append((abs(gap), record))
    return min(candidates, key=lambda item: item[0])[1] if candidates else None


def _stitch_previous_tracks(
    mapping: dict[int, int],
    summaries: dict[int, dict],
    previous: dict,
) -> None:
    previous_tracks = previous.get("tracks", {}) or {}
    candidates: list[tuple[float, int, int]] = []
    for local_id, summary in summaries.items():
        if local_id in mapping:
            continue
        for global_id_raw, previous_summary in previous_tracks.items():
            if summary["className"] != previous_summary.get("className"):
                continue
            iou = _compute_iou(summary["firstBBox"], previous_summary.get("lastBBox", []))
            if iou >= _MIN_STITCH_IOU:
                candidates.append((iou, local_id, int(global_id_raw)))

    used_local: set[int] = set(mapping)
    used_global: set[int] = set(mapping.values())
    for _iou, local_id, global_id in sorted(candidates, reverse=True):
        if local_id in used_local or global_id in used_global:
            continue
        mapping[local_id] = global_id
        used_local.add(local_id)
        used_global.add(global_id)


def _segment_record(
    start: float,
    end: float,
    summaries: dict[int, dict],
    mapping: dict[int, int],
) -> dict:
    return {
        "start": float(start),
        "end": float(end),
        "localToGlobal": {str(local_id): global_id for local_id, global_id in mapping.items()},
        "tracks": {
            str(mapping[local_id]): summary
            for local_id, summary in summaries.items()
        },
    }


def _segment_key(segment_id: int | str | None, start: float, end: float) -> str:
    if segment_id is not None and str(segment_id).strip():
        return f"id:{str(segment_id).strip()}"
    return f"time:{start:.3f}-{end:.3f}"


def _normalize_video_id(video_id: str, video_path: str) -> str:
    candidate = str(video_id or "").strip()
    if not candidate:
        candidate = hashlib.sha256(str(Path(video_path).resolve()).encode("utf-8")).hexdigest()[:16]
    normalized = re.sub(r"[^A-Za-z0-9_-]", "_", candidate)[:64]
    return normalized or "video"


def _video_fingerprint(video_path: str) -> dict:
    path = Path(video_path).resolve()
    try:
        stat = path.stat()
        return {
            "path": str(path),
            "size": stat.st_size,
            "modifiedNs": stat.st_mtime_ns,
            "identitySchema": _SCHEMA_VERSION,
        }
    except OSError:
        return {"path": str(path), "identitySchema": _SCHEMA_VERSION}


def _new_state(video_id: str, fingerprint: dict) -> dict:
    return {
        "version": _SCHEMA_VERSION,
        "videoId": video_id,
        "videoFingerprint": fingerprint,
        "nextTrackId": 1,
        "segments": {},
    }


def _load_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("version") == _SCHEMA_VERSION:
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def _write_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f".{os.getpid()}.tmp")
    temp_path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    temp_path.replace(path)


@contextmanager
def _exclusive_file_lock(path: Path, timeout_seconds: float = 10.0) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as lock_file:
        if lock_file.tell() == 0:
            lock_file.write(b"0")
            lock_file.flush()

        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                lock_file.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (OSError, BlockingIOError):
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out acquiring video identity lock: {path}")
                time.sleep(0.05)

        try:
            yield
        finally:
            lock_file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _compute_iou(bbox_a: list[float], bbox_b: list[float]) -> float:
    if len(bbox_a) != 4 or len(bbox_b) != 4:
        return 0.0
    ax1, ay1, aw, ah = bbox_a
    bx1, by1, bw, bh = bbox_b
    ax2, ay2 = ax1 + max(0.0, aw), ay1 + max(0.0, ah)
    bx2, by2 = bx1 + max(0.0, bw), by1 + max(0.0, bh)
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    intersection = (ix2 - ix1) * (iy2 - iy1)
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0.0
