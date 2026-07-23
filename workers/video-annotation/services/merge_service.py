"""Merge service — combines detection, tracking, semantic, and depth results."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def merge_results(
    tracks: list,              # list of FrameTrack from ByteTrack
    fine_objects: list[dict],  # LocateAnything-3B results
    semantic,                  # SegmentSemantic from Qwen3-VL
    depth_result,              # DepthResult from Depth Anything
    ocr_texts: list[dict] | None = None,   # TrOCR text regions
    transcript: dict | None = None,         # Whisper STT transcript
    video_width: int = 1920,
    video_height: int = 1080,
    person_ids: dict[int, str] | None = None,
) -> dict:
    """Merge all pipeline outputs into a unified SegmentAnnotation dict.

    Strategy:
    1. Build a track→attributes map from semantic results (person attributes matched by class).
    2. Match fine_objects (from LocateAnything-3B) to tracks based on spatial overlap.
    3. Attach depth/height from Depth Anything to each track's keyframe bbox.
    4. Append OCR-detected texts and audio transcript.
    5. Return structured dict matching the JSON schema.
    """
    ocr_texts = ocr_texts or []
    transcript = transcript or {}
    person_ids = person_ids or {}
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

    # Collect Qwen-described objects first (with semantic names, no precise bbox)
    qwen_objects: list[dict] = semantic.objects_attributes if semantic else []

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

        obj_entry = {
            "trackId": best_tid if best_tid is not None else fo.get("trackId", len(objects) + 100),
            "name": fo.get("className", "unknown"),
            "category": _infer_category(fo.get("className", "")),
            "color": fo.get("color", "unknown"),
            "brand": fo.get("brand"),
            "bbox": {"x": int(fo_x), "y": int(fo_y), "width": int(fo_w), "height": int(fo_h)},
            "depth": _get_depth_for_track(depth_result, best_tid),
        }
        objects.append(obj_entry)
        if best_tid is not None:
            matched_track_ids.add(best_tid)

    # ── Build persons list ─────────────────────────────
    persons: list[dict] = []

    # Match semantic person attributes to remaining tracks
    track_attrs: list[dict] = semantic.persons_attributes if semantic else []
    person_idx = 0  # match Qwen person[i] to ByteTrack person i

    for tid, t in track_map.items():
        if tid in dedup_ids:
            continue
        if tid in matched_track_ids:
            continue

        className = t.get("className", "unknown")

        # Non-person tracks (birds, butterflies, cars, etc.) go to objects
        if className != "person":
            # Try to match with a Qwen object description
            qwen_match = _match_qwen_object(qwen_objects, className)
            objects.append({
                "trackId": tid,
                "name": qwen_match.get("name") or className,
                "category": _infer_category(qwen_match.get("name", className)),
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

        attrs: dict = {}
        if person_idx < len(track_attrs):
            attrs = track_attrs[person_idx]
            person_idx += 1

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

    # Add leftover Qwen objects that don't semantically overlap with any YOLO track
    yolo_classes_seen = {t.get("className", "").lower() for t in track_map.values()}
    for qo in qwen_objects:
        q_name = qo.get("name", "").lower()
        # Skip if this Qwen object semantically matches any YOLO-detected class
        if any(_qwen_matches_yolo(q_name, yc) for yc in yolo_classes_seen):
            continue
        objects.append({
            "trackId": qo.get("trackId", len(objects) + 100),
            "name": qo.get("name", "unknown"),
            "category": qo.get("category", "other"),
            "color": qo.get("color", "unknown"),
            "brand": qo.get("brand"),
            "bbox": None,
            "depth": None,
        })

    # ── Build scene / camera from semantic ─────────────
    scene = semantic.scene if semantic else {"tags": [], "place": {}}
    camera = semantic.camera if semantic else {"shot": "unknown", "angle": "unknown", "movement": [], "lens": "unknown", "stabilization": "unknown"}
    events = semantic.events if semantic else []

    # ── Append OCR-detected text objects ───────────────
    ocr_start_id = max([o.get("trackId", 0) for o in objects], default=200) + 1
    for otr in ocr_texts:
        text = otr.get("text", "")
        if not text:
            continue
        bbox_data = otr.get("bbox")
        # Full-image bbox from TrOCR is not useful for display — keep as null
        bbox = None
        objects.append({
            "trackId": ocr_start_id,
            "name": text[:80],
            "category": "text",
            "color": "unknown",
            "brand": None,
            "bbox": bbox,
            "depth": None,
            "_textContent": text,
            "_detectionConfidence": otr.get("confidence", 0.85),
        })
        ocr_start_id += 1

    # ── Append audio transcript ────────────────────────
    if transcript.get("text"):
        events.append({
            "type": f"[Speech] {transcript['text'][:200]}",
            "confidence": transcript.get("confidence", 0.9),
        })

    return {
        "scene": scene,
        "camera": camera,
        "persons": persons,
        "objects": objects,
        "events": events,
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
    "bird": ["butterfly", "insect", "bird", "animal"],
    "dog": ["dog", "animal", "pet"],
    "cat": ["cat", "animal", "pet"],
    "car": ["car", "vehicle", "automobile"],
    "truck": ["truck", "vehicle"],
    "bus": ["bus", "vehicle"],
    "motorcycle": ["motorcycle", "motorbike", "vehicle"],
    "bicycle": ["bicycle", "bike", "vehicle"],
    "boat": ["boat", "ship", "vehicle"],
    "airplane": ["airplane", "plane", "aircraft", "vehicle"],
    "horse": ["horse", "animal"],
    "cow": ["cow", "animal"],
    "sheep": ["sheep", "animal"],
    "elephant": ["elephant", "animal"],
    "bear": ["bear", "animal"],
    "zebra": ["zebra", "animal"],
    "giraffe": ["giraffe", "animal"],
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

def _qwen_matches_yolo(qwen_name: str, yolo_class: str) -> bool:
    """Check if a Qwen object name semantically overlaps with a YOLO class."""
    hints = _YOLO_TO_QWEN_HINTS.get(yolo_class, [yolo_class])
    return qwen_name in hints or any(h in qwen_name or qwen_name in h for h in hints)
