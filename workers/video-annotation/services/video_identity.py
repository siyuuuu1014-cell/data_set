"""Video-scoped track and person identity assignment.

The detector/tracker runs once per annotation segment to keep GPU usage bounded.
This module combines conservative boundary overlap with person appearance ReID,
persists the ID allocator per video, and reconciles identities when segments are
processed out of order. Ambiguous tracks still receive new IDs because a false
split is safer than merging two different people.
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

from config import (
    CACHE_DIR,
    PERSON_REID_MATCH_THRESHOLD,
    PERSON_REID_MAX_GAP_SECONDS,
)

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = 2
_MAX_STITCH_GAP_SECONDS = 2.5
_MIN_STITCH_IOU = 0.65
_PERSON_REID_CONFLICT_THRESHOLD = 0.35
_thread_lock = threading.RLock()


@dataclass(frozen=True)
class IdentityAssignment:
    """Identity data for the globally remapped tracks in one segment."""

    track_ids: frozenset[int]
    person_ids: dict[int, str]
    aliases: dict[int, int]


def assign_video_identities(
    tracks: list,
    *,
    video_id: str,
    video_path: str,
    segment_id: int | str | None,
    segment_start: float,
    segment_end: float,
    track_embeddings: dict[int, list[float]] | None = None,
    registry_root: Path | None = None,
) -> IdentityAssignment:
    """Remap local tracker IDs to stable video-scoped IDs in place.

    Existing mappings are reused when the same segment is annotated again.
    Nearby segments can be linked by high-confidence appearance similarity or
    boundary IoU. All other tracks get fresh IDs.
    """
    summaries = _summarize_tracks(tracks, track_embeddings or {})
    if not summaries:
        return IdentityAssignment(frozenset(), {}, {})

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
        aliases = _normalized_aliases(state.get("aliases", {}))
        mapping = _match_existing_segment(existing, summaries, aliases)

        neighbors = _find_neighbor_segments(
            segments,
            current_key=segment_key,
            segment_start=segment_start,
            segment_end=segment_end,
        )
        for _gap, neighbor_before, neighbor in neighbors:
            _stitch_neighbor_tracks(
                mapping,
                summaries,
                neighbor,
                neighbor_before=neighbor_before,
                state=state,
                aliases=aliases,
            )

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

        mapping = {
            local_id: _resolve_alias(global_id, aliases)
            for local_id, global_id in mapping.items()
        }
        state["nextTrackId"] = next_track_id
        segments[segment_key] = _segment_record(
            segment_start,
            segment_end,
            summaries,
            mapping,
        )
        _apply_aliases_to_segments(segments, aliases)
        state["aliases"] = {
            str(old_id): _resolve_alias(new_id, aliases)
            for old_id, new_id in aliases.items()
            if old_id != _resolve_alias(new_id, aliases)
        }
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
    effective_aliases = {
        old_id: _resolve_alias(new_id, aliases)
        for old_id, new_id in aliases.items()
        if old_id != _resolve_alias(new_id, aliases)
    }
    return IdentityAssignment(frozenset(mapping.values()), person_ids, effective_aliases)


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
    return IdentityAssignment(frozenset(mapping.values()), person_ids, {})


def _summarize_tracks(
    tracks: list,
    track_embeddings: dict[int, list[float]],
) -> dict[int, dict]:
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
                    "observationCount": 0,
                },
            )
            summary["lastBBox"] = bbox
            summary["observationCount"] += 1
    for local_id, summary in summaries.items():
        embedding = track_embeddings.get(local_id)
        if summary["className"] == "person" and _valid_embedding(embedding):
            summary["embedding"] = embedding
    return summaries


def _match_existing_segment(
    existing: dict | None,
    summaries: dict[int, dict],
    aliases: dict[int, int],
) -> dict[int, int]:
    if not existing:
        return {}
    stored = existing.get("localToGlobal", {}) or {}
    stored_tracks = existing.get("tracks", {}) or {}
    mapping: dict[int, int] = {}
    used_global_ids: set[int] = set()

    # A rerun of the same segment should keep its persisted local-to-global
    # mapping whenever the class and any available appearance evidence agree.
    # Matching by position first can silently swap two nearby people even when
    # the tracker emitted the same local IDs as the previous run.
    for local_id, summary in summaries.items():
        global_id = stored.get(str(local_id), stored.get(local_id))
        if global_id is None:
            continue
        canonical = _resolve_alias(int(global_id), aliases)
        previous_summary = stored_tracks.get(str(canonical), {})
        if canonical <= 0 or canonical in used_global_ids:
            continue
        if not _stored_mapping_is_compatible(summary, previous_summary):
            continue
        mapping[local_id] = canonical
        used_global_ids.add(canonical)

    unmatched = {
        local_id: summary
        for local_id, summary in summaries.items()
        if local_id not in mapping
    }
    mapping.update(
        _greedy_record_matches(
            unmatched,
            existing,
            aliases,
            same_segment=True,
            unavailable_global_ids=used_global_ids,
        )
    )
    return mapping


def _stored_mapping_is_compatible(current: dict, stored: dict) -> bool:
    if current.get("className") != stored.get("className"):
        return False
    if current.get("className") != "person":
        return True
    similarity = _cosine_similarity(current.get("embedding"), stored.get("embedding"))
    return similarity is None or similarity > _PERSON_REID_CONFLICT_THRESHOLD


def _find_neighbor_segments(
    segments: dict,
    *,
    current_key: str,
    segment_start: float,
    segment_end: float,
) -> list[tuple[float, bool, dict]]:
    candidates: list[tuple[float, bool, dict]] = []
    for key, record in segments.items():
        if key == current_key:
            continue
        try:
            other_start = float(record["start"])
            other_end = float(record["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if other_end <= segment_start + 0.05:
            gap = max(0.0, segment_start - other_end)
            neighbor_before = True
        elif other_start >= segment_end - 0.05:
            gap = max(0.0, other_start - segment_end)
            neighbor_before = False
        else:
            continue
        if gap <= PERSON_REID_MAX_GAP_SECONDS:
            candidates.append((gap, neighbor_before, record))
    return sorted(candidates, key=lambda item: item[0])


def _stitch_neighbor_tracks(
    mapping: dict[int, int],
    summaries: dict[int, dict],
    neighbor: dict,
    *,
    neighbor_before: bool,
    state: dict,
    aliases: dict[int, int],
) -> None:
    matches = _greedy_record_matches(
        summaries,
        neighbor,
        aliases,
        same_segment=False,
        neighbor_before=neighbor_before,
    )
    claimed_globals: dict[int, int] = {
        _resolve_alias(global_id, aliases): local_id
        for local_id, global_id in mapping.items()
    }
    for local_id, neighbor_global_id in matches.items():
        neighbor_global_id = _resolve_alias(neighbor_global_id, aliases)
        existing_local = claimed_globals.get(neighbor_global_id)
        if existing_local is not None and existing_local != local_id:
            continue
        current_global_id = mapping.get(local_id)
        if current_global_id is None:
            mapping[local_id] = neighbor_global_id
            claimed_globals[neighbor_global_id] = local_id
            continue
        current_global_id = _resolve_alias(current_global_id, aliases)
        if current_global_id == neighbor_global_id:
            continue
        if not _can_alias(state, current_global_id, neighbor_global_id):
            continue
        canonical = min(current_global_id, neighbor_global_id)
        replaced = max(current_global_id, neighbor_global_id)
        aliases[replaced] = canonical
        mapping[local_id] = canonical
        claimed_globals.pop(replaced, None)
        claimed_globals[canonical] = local_id


def _greedy_record_matches(
    summaries: dict[int, dict],
    record: dict,
    aliases: dict[int, int],
    *,
    same_segment: bool,
    neighbor_before: bool = True,
    unavailable_global_ids: set[int] | None = None,
) -> dict[int, int]:
    candidates: list[tuple[float, int, int]] = []
    unavailable = unavailable_global_ids or set()
    for local_id, summary in summaries.items():
        for global_id_raw, stored_summary in (record.get("tracks", {}) or {}).items():
            if summary.get("className") != stored_summary.get("className"):
                continue
            global_id = _resolve_alias(int(global_id_raw), aliases)
            if global_id in unavailable:
                continue
            score = _identity_match_score(
                summary,
                stored_summary,
                same_segment=same_segment,
                neighbor_before=neighbor_before,
            )
            if score is not None:
                candidates.append((score, local_id, global_id))

    mapping: dict[int, int] = {}
    used_global_ids: set[int] = set()
    for _score, local_id, global_id in sorted(candidates, reverse=True):
        if local_id in mapping or global_id in used_global_ids:
            continue
        mapping[local_id] = global_id
        used_global_ids.add(global_id)
    return mapping


def _identity_match_score(
    current: dict,
    stored: dict,
    *,
    same_segment: bool,
    neighbor_before: bool,
) -> float | None:
    if same_segment:
        current_bbox = current.get("firstBBox", [])
        stored_bbox = stored.get("firstBBox", [])
    elif neighbor_before:
        current_bbox = current.get("firstBBox", [])
        stored_bbox = stored.get("lastBBox", [])
    else:
        current_bbox = current.get("lastBBox", [])
        stored_bbox = stored.get("firstBBox", [])
    iou = _compute_iou(current_bbox, stored_bbox)
    if current.get("className") == "person":
        similarity = _cosine_similarity(current.get("embedding"), stored.get("embedding"))
        if similarity is not None:
            if similarity >= PERSON_REID_MATCH_THRESHOLD:
                return 2.0 + similarity + min(iou, 1.0) * 0.05
            # When both person embeddings are available, a clear appearance
            # conflict must not be overridden by positional overlap.
            if similarity <= _PERSON_REID_CONFLICT_THRESHOLD:
                return None
    minimum_iou = 0.35 if same_segment else _MIN_STITCH_IOU
    if iou >= minimum_iou:
        return 1.0 + iou
    return None


def _valid_embedding(value: object) -> bool:
    return isinstance(value, list) and len(value) > 0 and all(
        isinstance(item, (int, float)) for item in value
    )


def _cosine_similarity(left: object, right: object) -> float | None:
    if not _valid_embedding(left) or not _valid_embedding(right):
        return None
    if len(left) != len(right):
        return None
    dot = sum(float(a) * float(b) for a, b in zip(left, right))
    left_norm = sum(float(value) ** 2 for value in left) ** 0.5
    right_norm = sum(float(value) ** 2 for value in right) ** 0.5
    if left_norm <= 1e-9 or right_norm <= 1e-9:
        return None
    return dot / (left_norm * right_norm)


def _normalized_aliases(raw: object) -> dict[int, int]:
    if not isinstance(raw, dict):
        return {}
    aliases: dict[int, int] = {}
    for old_id, new_id in raw.items():
        try:
            old_value = int(old_id)
            new_value = int(new_id)
        except (TypeError, ValueError):
            continue
        if old_value > 0 and new_value > 0 and old_value != new_value:
            aliases[old_value] = new_value
    return aliases


def _resolve_alias(global_id: int, aliases: dict[int, int]) -> int:
    current = int(global_id)
    visited: set[int] = set()
    while current in aliases and current not in visited:
        visited.add(current)
        current = int(aliases[current])
    return current


def _can_alias(state: dict, left: int, right: int) -> bool:
    for record in (state.get("segments", {}) or {}).values():
        values = {
            int(value)
            for value in (record.get("localToGlobal", {}) or {}).values()
        }
        if left in values and right in values:
            return False

    left_class, left_embedding = _identity_appearance(state, left)
    right_class, right_embedding = _identity_appearance(state, right)
    if left_class is None or right_class is None or left_class != right_class:
        return False
    if left_class == "person":
        similarity = _cosine_similarity(left_embedding, right_embedding)
        if similarity is None or similarity < PERSON_REID_MATCH_THRESHOLD:
            return False
    return True


def _identity_appearance(state: dict, global_id: int) -> tuple[str | None, list[float] | None]:
    aliases = _normalized_aliases(state.get("aliases", {}))
    classes: set[str] = set()
    embeddings: list[list[float]] = []
    for record in (state.get("segments", {}) or {}).values():
        for raw_id, summary in (record.get("tracks", {}) or {}).items():
            try:
                candidate_id = _resolve_alias(int(raw_id), aliases)
            except (TypeError, ValueError):
                continue
            if candidate_id != global_id or not isinstance(summary, dict):
                continue
            class_name = str(summary.get("className", "")).strip()
            if class_name:
                classes.add(class_name)
            embedding = summary.get("embedding")
            if _valid_embedding(embedding):
                embeddings.append([float(value) for value in embedding])

    class_name = next(iter(classes)) if len(classes) == 1 else None
    return class_name, _mean_embedding(embeddings)


def _mean_embedding(embeddings: list[list[float]]) -> list[float] | None:
    if not embeddings:
        return None
    dimension = len(embeddings[0])
    compatible = [embedding for embedding in embeddings if len(embedding) == dimension]
    if not compatible:
        return None
    return [
        sum(embedding[index] for embedding in compatible) / len(compatible)
        for index in range(dimension)
    ]


def _apply_aliases_to_segments(segments: dict, aliases: dict[int, int]) -> None:
    for record in segments.values():
        local_to_global = record.get("localToGlobal", {}) or {}
        record["localToGlobal"] = {
            str(local_id): _resolve_alias(int(global_id), aliases)
            for local_id, global_id in local_to_global.items()
        }
        normalized_tracks: dict[str, dict] = {}
        for global_id, summary in (record.get("tracks", {}) or {}).items():
            canonical = str(_resolve_alias(int(global_id), aliases))
            existing = normalized_tracks.get(canonical)
            if existing is None or int(summary.get("observationCount", 0)) > int(existing.get("observationCount", 0)):
                normalized_tracks[canonical] = summary
        record["tracks"] = normalized_tracks


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
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    if data.get("version") == _SCHEMA_VERSION:
        return data
    if data.get("version") == 1:
        migrated = _migrate_v1_state(data)
        if migrated:
            logger.info("Migrated video identity registry schema v1 to v2: %s", path)
            return migrated
    return {}


def _migrate_v1_state(data: dict) -> dict:
    """Upgrade a valid v1 registry in memory without changing assigned IDs."""
    segments = data.get("segments")
    fingerprint = data.get("videoFingerprint")
    if not isinstance(segments, dict) or not isinstance(fingerprint, dict):
        return {}

    for record in segments.values():
        if not isinstance(record, dict):
            return {}
        tracks = record.get("tracks", {})
        if not isinstance(tracks, dict):
            return {}
        for summary in tracks.values():
            if not isinstance(summary, dict):
                return {}
            try:
                observation_count = int(summary.get("observationCount", 1))
            except (TypeError, ValueError):
                observation_count = 1
            summary["observationCount"] = max(1, observation_count)

    data["version"] = _SCHEMA_VERSION
    data.setdefault("aliases", {})
    fingerprint["identitySchema"] = _SCHEMA_VERSION
    return data


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
