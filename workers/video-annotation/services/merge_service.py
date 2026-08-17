"""Merge service — combines detection, tracking, semantic, and depth results."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

_OCR_TRACK_ID_BASE = 1_000_000


def _semantic_attributes_by_track(items: list[dict]) -> dict[int, dict]:
    """Index only explicit model Track IDs; never infer identity from order."""
    indexed: dict[int, dict] = {}
    for item in items:
        if not isinstance(item, dict) or isinstance(item.get("trackId"), bool):
            continue
        try:
            track_id = int(item["trackId"])
        except (KeyError, TypeError, ValueError):
            continue
        if track_id < 0 or track_id in indexed:
            continue
        indexed[track_id] = item
    return indexed


def merge_results(
    tracks: list,              # list of FrameTrack from ByteTrack
    fine_objects: list[dict],  # LocateAnything-3B results
    semantic,                  # SegmentSemantic from Qwen3-VL
    depth_result,              # DepthResult from Depth Anything
    ocr_texts: list[dict] | None = None,   # detected OCR text regions
    transcript: dict | None = None,         # Whisper STT transcript
    recognition_status: dict | None = None,
    video_width: int = 1920,
    video_height: int = 1080,
    person_ids: dict[int, str] | None = None,
    segment_start: float = 0.0,
    tracking_fps: float = 1.0,
    video_fps: float = 0.0,
) -> dict:
    """Merge all pipeline outputs into a unified SegmentAnnotation dict.

    Strategy:
    1. Build a track→attributes map from semantic results (person attributes matched by class).
    2. Match fine_objects (from LocateAnything-3B) to tracks based on spatial overlap.
    3. Attach depth/height from Depth Anything to each track's keyframe bbox.
    4. Append OCR-detected texts and keep audio transcript separate from visual events.
    5. Return structured dict matching the JSON schema.
    """
    ocr_texts = ocr_texts or []
    transcript = transcript or {}
    recognition_status = recognition_status or {}
    person_ids = person_ids or {}
    spatial_object_timestamps: dict[int, float] = {}
    # Collect unique tracks across all frames (trackId → { className, bbox, confidence })
    track_map: dict[int, dict] = {}
    for ft in tracks:
        for t in ft.tracks:
            tid = t["trackId"]
            if tid not in track_map:
                track_map[tid] = {
                    "trackId": tid,
                    "className": t["className"],
                    "bbox": t["bbox"],
                    "detectionConfidence": t.get("detectionConfidence", 0),
                    "trackingConfidence": t.get("trackingConfidence", 0),
                }

    # ── Deduplicate overlapping tracks (same YOLO class, high IOU) ──
    # ByteTrack sometimes fragments one object into two nearby tracks.
    # Keep the one with higher detection confidence.
    dedup_ids: set[int] = set()
    track_list = list(track_map.items())
    for i in range(len(track_list)):
        tid_a, ta = track_list[i]
        if tid_a in dedup_ids:
            continue
        for j in range(i + 1, len(track_list)):
            tid_b, tb = track_list[j]
            if tid_b in dedup_ids:
                continue
            if ta["className"] != tb["className"]:
                continue
            iou = _compute_iou(
                [ta["bbox"][0], ta["bbox"][1], ta["bbox"][2], ta["bbox"][3]],
                [tb["bbox"][0], tb["bbox"][1], tb["bbox"][2], tb["bbox"][3]],
            )
            if iou > 0.5:
                # Remove the one with lower confidence
                if ta["detectionConfidence"] >= tb["detectionConfidence"]:
                    dedup_ids.add(tid_b)
                else:
                    dedup_ids.add(tid_a)

    # ── Build objects list ─────────────────────────────
    objects: list[dict] = []

    # Semantic entity attributes are accepted only when the provider returned
    # an explicit detector Track ID. Array position is not an identity signal.
    qwen_objects: list[dict] = semantic.objects_attributes if semantic else []
    qwen_objects_by_track = _semantic_attributes_by_track(qwen_objects)

    # Match fine_objects (LocateAnything) to tracks
    matched_track_ids: set[int] = set()
    for fo in fine_objects:
        fo_bbox = fo["bbox"]  # [x1, y1, x2, y2]
        fo_x, fo_y = fo_bbox[0], fo_bbox[1]
        fo_w, fo_h = fo_bbox[2] - fo_bbox[0], fo_bbox[3] - fo_bbox[1]

        best_iou = 0.0
        best_tid: int | None = None

        for tid, t in track_map.items():
            if tid in dedup_ids:
                continue
            if tid in matched_track_ids:
                continue
            iou = _compute_iou(
                [fo_x, fo_y, fo_w, fo_h],
                t["bbox"],
            )
            if iou > best_iou and iou > 0.3:
                best_iou = iou
                best_tid = tid

        semantic_match = qwen_objects_by_track.get(best_tid, {}) if best_tid is not None else {}
        fine_color = fo.get("color")
        obj_entry = {
            "trackId": best_tid if best_tid is not None else fo.get("trackId", len(objects) + 100),
            "name": fo.get("className", "unknown"),
            "category": _infer_category(fo.get("className", "")),
            "color": (
                semantic_match.get("color") or "unknown"
                if not fine_color or str(fine_color).lower() == "unknown"
                else fine_color
            ),
            "brand": fo.get("brand") or semantic_match.get("brand"),
            "bbox": {"x": int(fo_x), "y": int(fo_y), "width": int(fo_w), "height": int(fo_h)},
            "depth": _get_depth_for_track(depth_result, best_tid),
        }
        objects.append(obj_entry)
        spatial_object_timestamps[int(obj_entry["trackId"])] = float(segment_start)
        if best_tid is not None:
            matched_track_ids.add(best_tid)

    # ── Build persons list ─────────────────────────────
    persons: list[dict] = []

    # Match semantic person attributes to remaining tracks by explicit Track ID.
    track_attrs: list[dict] = semantic.persons_attributes if semantic else []
    track_attrs_by_id = _semantic_attributes_by_track(track_attrs)

    for tid, t in track_map.items():
        if tid in dedup_ids:
            continue
        if tid in matched_track_ids:
            continue

        className = t.get("className", "unknown")

        # Non-person tracks (birds, butterflies, cars, etc.) go to objects
        if className != "person":
            qwen_match = qwen_objects_by_track.get(tid, {})
            objects.append({
                "trackId": tid,
                # A semantic model may enrich attributes, but it must never
                # rename a detector-confirmed class into an unrelated object.
                "name": className,
                "category": _infer_category(className),
                "color": qwen_match.get("color") or "unknown",
                "brand": qwen_match.get("brand"),
                "bbox": {
                    "x": int(t["bbox"][0]),
                    "y": int(t["bbox"][1]),
                    "width": int(t["bbox"][2]),
                    "height": int(t["bbox"][3]),
                },
                "depth": _get_depth_for_track(depth_result, tid),
                "_detectionConfidence": t.get("detectionConfidence", 0),
            })
            continue

        attrs = track_attrs_by_id.get(tid, {})

        person = {
            "trackId": tid,
            "personId": person_ids.get(tid),
            "gender": attrs.get("gender", "unknown"),
            "ageGroup": attrs.get("ageGroup", "unknown"),
            "hair": attrs.get("hair", {"color": "unknown", "style": "unknown"}),
            "expression": attrs.get("expression", "unknown"),
            "pose": attrs.get("pose", "unknown"),
            "action": attrs.get("action", []),
            "facing": attrs.get("facing", "unknown"),
            "occlusion": attrs.get("occlusion", 0),
            "clothing": attrs.get("clothing", []),
            # Include YOLO class name for display
            "_className": t["className"],
            "_detectionConfidence": t.get("detectionConfidence", 0),
            "bbox": {
                "x": int(t["bbox"][0]),
                "y": int(t["bbox"][1]),
                "width": int(t["bbox"][2]),
                "height": int(t["bbox"][3]),
            },
            "depth": _get_depth_for_track(depth_result, tid),
            "keypoints": [],
        }
        persons.append(person)

    # Qwen is used for semantic enrichment, not object existence. Unmatched
    # Qwen objects have no localization evidence and are intentionally omitted.
    confirmed_names = {
        str(obj.get("name", "")).lower()
        for obj in objects
        if obj.get("name") and obj.get("bbox") is not None
    }
    unconfirmed_qwen_names = {
        str(qo.get("name", "")).lower().strip()
        for qo in qwen_objects
        if qo.get("name") and str(qo.get("name", "")).lower().strip() not in confirmed_names
    }
    if unconfirmed_qwen_names:
        logger.info(
            "Discarded %d unlocalized Qwen object claims: %s",
            len(unconfirmed_qwen_names),
            ", ".join(sorted(unconfirmed_qwen_names)),
        )

    # ── Build scene / camera from semantic ─────────────
    scene = semantic.scene if semantic else {"tags": [], "place": {}}
    camera = semantic.camera if semantic else {"shot": "unknown", "angle": "unknown", "movement": [], "lens": "unknown", "stabilization": "unknown"}
    events = _filter_semantic_events(
        list(semantic.events) if semantic else [],
        unconfirmed_qwen_names,
    )
    if not events:
        grounded_event = _build_grounded_visual_event(persons, objects)
        if grounded_event:
            events = [grounded_event]

    # ── Append OCR-detected text objects ───────────────
    # OCR regions live in a reserved high-ID namespace and scan every raw
    # detector track as well as merged summaries. This prevents OCR text from
    # inheriting or overwriting an object track that was filtered or deduped.
    existing_track_ids = [int(track_id) for track_id in track_map]
    existing_track_ids.extend(o.get("trackId", 0) for o in objects)
    existing_track_ids.extend(p.get("trackId", 0) for p in persons)
    ocr_start_id = max(_OCR_TRACK_ID_BASE, max(existing_track_ids, default=0) + 1)
    for otr in ocr_texts:
        text = otr.get("text", "")
        if not text:
            continue
        bbox_data = otr.get("bbox")
        bbox = None
        if isinstance(bbox_data, dict) and all(
            key in bbox_data for key in ("x", "y", "width", "height")
        ):
            bbox = {
                "x": int(bbox_data["x"]),
                "y": int(bbox_data["y"]),
                "width": int(bbox_data["width"]),
                "height": int(bbox_data["height"]),
            }
        text_entry = {
            "trackId": ocr_start_id,
            "name": text[:80],
            "category": "text",
            "color": "unknown",
            "brand": None,
            "bbox": bbox,
            "depth": None,
            "_textContent": text,
        }
        confidence = otr.get("confidence")
        if isinstance(confidence, (int, float)):
            text_entry["_detectionConfidence"] = float(confidence)
        objects.append(text_entry)
        spatial_object_timestamps[int(text_entry["trackId"])] = float(
            otr.get("_timestamp", segment_start)
        )
        ocr_start_id += 1

    # Speech is recognition output, not a visual event. Older saved results
    # used "[Speech] ..." event entries; the web layer still reads those as a
    # legacy fallback without producing them for new annotations.
    speech_transcript = str(transcript.get("text", "")).strip()

    # Preserve the spatial result for every sampled tracking frame. The legacy
    # persons/objects arrays above remain as segment summaries so old clients
    # and export formats continue to work.
    safe_tracking_fps = max(float(tracking_fps or 0), 0.001)
    safe_video_fps = max(float(video_fps or 0), safe_tracking_fps)
    person_track_ids = {int(person["trackId"]) for person in persons}
    objects_by_track_id = {int(obj["trackId"]): obj for obj in objects}
    frames: list[dict] = []
    for ft in tracks:
        timestamp = float(segment_start) + (float(ft.frame_index) / safe_tracking_fps)
        observations: list[dict] = []
        for track in ft.tracks:
            track_id = int(track["trackId"])
            if track_id in dedup_ids:
                continue
            class_name = str(track.get("className") or "unknown")
            entity_type = "person" if track_id in person_track_ids else "object"
            if entity_type == "object" and track_id in objects_by_track_id:
                class_name = str(objects_by_track_id[track_id].get("name") or class_name)
            bbox = track.get("bbox") or [0, 0, 0, 0]
            observations.append({
                "trackId": track_id,
                "entityType": entity_type,
                "className": class_name,
                "bbox": {
                    "x": int(bbox[0]),
                    "y": int(bbox[1]),
                    "width": int(bbox[2]),
                    "height": int(bbox[3]),
                },
                "confidence": float(track.get("detectionConfidence", 0)),
                "source": "model",
            })
        frames.append({
            "frameIndex": max(0, int(round(timestamp * safe_video_fps))),
            "timestamp": timestamp,
            "imageWidth": int(video_width),
            "imageHeight": int(video_height),
            "observations": observations,
        })

    # LocateAnything runs on the first semantic keyframe and OCR retains the
    # timestamp of the keyframe that supplied its best deduplicated result.
    # Attach those localized boxes to the nearest sampled frame instead of
    # dropping them from the frame editor or pretending they exist everywhere.
    for obj in objects:
        bbox = obj.get("bbox")
        track_id = int(obj.get("trackId", 0))
        source_timestamp = spatial_object_timestamps.get(track_id)
        if bbox is None or source_timestamp is None:
            continue
        if any(
            observation.get("entityType") == "object"
            and int(observation.get("trackId", -1)) == track_id
            for frame in frames
            for observation in frame["observations"]
        ):
            continue
        if frames:
            target_frame = min(frames, key=lambda frame: abs(frame["timestamp"] - source_timestamp))
        else:
            target_frame = {
                "frameIndex": max(0, int(round(source_timestamp * safe_video_fps))),
                "timestamp": source_timestamp,
                "imageWidth": int(video_width),
                "imageHeight": int(video_height),
                "observations": [],
            }
            frames.append(target_frame)
        target_frame["observations"].append({
            "trackId": track_id,
            "entityType": "object",
            "className": str(obj.get("name") or "object"),
            "bbox": dict(bbox),
            "confidence": float(obj.get("_detectionConfidence", 0)),
            "source": "model",
        })

    frames.sort(key=lambda frame: (frame["timestamp"], frame["frameIndex"]))

    return {
        "scene": scene,
        "camera": camera,
        "persons": persons,
        "objects": objects,
        "events": events,
        "frames": frames,
        "speechTranscript": speech_transcript,
        "_recognition": recognition_status,
    }


def _compute_iou(bbox_a: list[float], bbox_b: list[float]) -> float:
    """IoU of two [x, y, w, h] boxes."""
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
    return inter / (area_a + area_b - inter) if (area_a + area_b - inter) > 0 else 0.0


def _get_depth_for_track(depth_result, track_id: int | None) -> float | None:
    if depth_result is None or track_id is None:
        return None
    for od in depth_result.objects_depths:
        if od.get("trackId") == track_id:
            return od.get("depth")
    return None





def _infer_category(name: str) -> str:
    """Infer object category from class name."""
    furniture = {"chair", "table", "desk", "sofa", "bed", "cabinet", "shelf", "stool", "bench"}
    instrument = {"piano", "guitar", "violin", "drum", "flute", "saxophone"}
    vehicle = {"car", "bus", "truck", "bicycle", "motorcycle", "boat", "airplane"}
    electronics = {"tv", "laptop", "phone", "monitor", "keyboard", "mouse", "camera"}
    kitchenware = {"cup", "bottle", "plate", "bowl", "knife", "fork", "spoon", "pot", "pan"}
    animal = {"bird", "cat", "dog", "butterfly", "insect", "horse", "cow", "sheep", "fish", "snake", "frog", "rabbit", "deer", "bear", "animal"}

    name_lower = name.lower()
    if name_lower in furniture:
        return "furniture"
    if name_lower in instrument:
        return "instrument"
    if name_lower in vehicle:
        return "vehicle"
    if name_lower in electronics:
        return "electronics"
    if name_lower in kitchenware:
        return "kitchenware"
    if name_lower in animal:
        return "animal"

    return "other"

# ── Qwen object matching ──────────────────────────────

# Mapping from YOLO class names to broader categories Qwen might describe
_YOLO_TO_QWEN_HINTS: dict[str, list[str]] = {
    "bird": ["bird"],
    "dog": ["dog"],
    "cat": ["cat"],
    "car": ["car", "automobile"],
    "truck": ["truck"],
    "bus": ["bus"],
    "motorcycle": ["motorcycle", "motorbike"],
    "bicycle": ["bicycle", "bike"],
    "boat": ["boat", "ship"],
    "airplane": ["airplane", "plane", "aircraft"],
    "horse": ["horse"],
    "cow": ["cow"],
    "sheep": ["sheep"],
    "elephant": ["elephant"],
    "bear": ["bear"],
    "zebra": ["zebra"],
    "giraffe": ["giraffe"],
}

def _match_qwen_object(qwen_objects: list[dict], yolo_class: str) -> dict:
    """Find the best Qwen object description for a YOLO class name.
    Non-consuming: multiple tracks of the same class can all use the same Qwen hint.
    Returns the matched Qwen object, or empty dict if no match.
    """
    hints = _YOLO_TO_QWEN_HINTS.get(yolo_class.lower(), [yolo_class.lower()])
    for qo in qwen_objects:
        q_name = qo.get("name", "").lower()
        if q_name in hints or any(h in q_name or q_name in h for h in hints):
            return qo
    return {}

_LEGACY_PROMPT_EVENT_ECHOES = {
    "a butterfly is resting on a flower",
}


def _filter_semantic_events(
    events: list[dict],
    unconfirmed_object_names: set[str],
) -> list[dict]:
    """Drop semantic events that depend on an unlocalized object claim."""
    filtered: list[dict] = []
    for event in events:
        event_type = str(event.get("type", "")).strip()
        event_description = str(event.get("description", "")).strip()
        event_text = " ".join(value for value in (event_type, event_description) if value)
        normalized = re.sub(r"\s+", " ", event_text.lower()).strip(" .")
        if not normalized:
            continue
        if normalized in _LEGACY_PROMPT_EVENT_ECHOES:
            logger.info("Discarded legacy prompt-echo event: %s", event_text)
            continue
        unsupported = any(
            re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", normalized)
            for name in unconfirmed_object_names
            if name
        )
        if unsupported:
            logger.info("Discarded event with unlocalized object claim: %s", event_text)
            continue
        filtered.append(event)
    return filtered


def _build_grounded_visual_event(
    persons: list[dict],
    objects: list[dict],
) -> dict | None:
    """Build a concise visual-only fallback from localized observations."""
    actions: list[str] = []
    for person in persons:
        for raw_action in person.get("action", []):
            action = re.sub(r"\s+", " ", str(raw_action)).strip()
            if action and action.lower() != "unknown" and action not in actions:
                actions.append(action)

    object_names: list[str] = []
    for obj in objects:
        if obj.get("bbox") is None or obj.get("category") == "text":
            continue
        name = re.sub(r"\s+", " ", str(obj.get("name", ""))).strip()
        if name and name.lower() != "unknown" and name not in object_names:
            object_names.append(name)

    parts: list[str] = []
    if persons:
        person_label = "one person" if len(persons) == 1 else f"{len(persons)} people"
        if actions:
            parts.append(
                f"The frame shows {person_label}, with visible actions including "
                f"{_join_english(actions[:3])}"
            )
        else:
            parts.append(f"The frame shows {person_label}")
    if object_names:
        object_phrase = _join_english(object_names[:3])
        if parts:
            parts.append(f"alongside {object_phrase}")
        else:
            parts.append(f"The frame shows {object_phrase}")
    if not parts:
        return None

    return {
        "type": "visual_activity",
        "description": ", ".join(parts) + ".",
        "confidence": 0.6,
    }


def _join_english(values: list[str]) -> str:
    if len(values) < 2:
        return values[0] if values else ""
    if len(values) == 2:
        return f"{values[0]} and {values[1]}"
    return f"{', '.join(values[:-1])}, and {values[-1]}"
