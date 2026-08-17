"""OpenCV Zoo YoutuReID provider for lightweight person appearance matching.

The model is a public ONNX asset from the OpenCV model zoo. It is resolved
through the existing Hugging Face cache and runs on CPU via OpenCV DNN.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np

from config import (
    PERSON_REID_FILENAME,
    PERSON_REID_MODEL_PATH,
    PERSON_REID_REPO,
    PERSON_REID_REVISION,
)
from services.frame_sampling import load_frame_as_array

logger = logging.getLogger(__name__)

_INPUT_SIZE = (128, 256)
_MEAN = np.asarray((0.485, 0.456, 0.406), dtype=np.float32)
_STD = np.asarray((0.229, 0.224, 0.225), dtype=np.float32)
_MAX_CROPS_PER_TRACK = 3


class YoutuPersonReID:
    """Generate one normalized appearance embedding per person track."""

    def __init__(self, model_path: str | None = None) -> None:
        self._model_path = (model_path or PERSON_REID_MODEL_PATH).strip()
        self._net: Any = None

    @property
    def model_path(self) -> str:
        return self._model_path

    def load(self) -> None:
        if self._net is not None:
            return
        if not self._model_path:
            default_cache_path = _default_hf_cache_path()
            if default_cache_path.is_file():
                self._model_path = str(default_cache_path)
        if not self._model_path:
            from huggingface_hub import hf_hub_download
            from huggingface_hub.errors import LocalEntryNotFoundError

            try:
                self._model_path = hf_hub_download(
                    repo_id=PERSON_REID_REPO,
                    filename=PERSON_REID_FILENAME,
                    revision=PERSON_REID_REVISION,
                    local_files_only=True,
                )
            except LocalEntryNotFoundError:
                self._model_path = hf_hub_download(
                    repo_id=PERSON_REID_REPO,
                    filename=PERSON_REID_FILENAME,
                    revision=PERSON_REID_REVISION,
                )
        path = Path(self._model_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Person ReID model not found: {path}")

        import cv2

        self._net = cv2.dnn.readNet(str(path))
        self._net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self._net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self._model_path = str(path)
        logger.info("Youtu person ReID loaded on CPU: %s", path)

    def unload(self) -> None:
        self._net = None
        logger.info("Youtu person ReID unloaded")

    def embed_tracks(self, frames: list[np.ndarray], tracks: list) -> dict[int, list[float]]:
        return self._embed_tracks_with_loader(
            tracks,
            frame_count=len(frames),
            frame_loader=lambda index: frames[index],
        )

    def embed_track_paths(self, frame_paths: list[str], tracks: list) -> dict[int, list[float]]:
        cache: dict[int, np.ndarray] = {}

        def load(index: int) -> np.ndarray:
            if index not in cache:
                cache[index] = load_frame_as_array(frame_paths[index])
            return cache[index]

        return self._embed_tracks_with_loader(
            tracks,
            frame_count=len(frame_paths),
            frame_loader=load,
        )

    def _embed_tracks_with_loader(
        self,
        tracks: list,
        *,
        frame_count: int,
        frame_loader: Any,
    ) -> dict[int, list[float]]:
        if self._net is None:
            self.load()

        observations: dict[int, list[tuple[int, list[float], float]]] = {}
        for frame_position, frame_track in enumerate(tracks):
            if frame_position >= frame_count:
                break
            for track in frame_track.tracks:
                if track.get("className") != "person":
                    continue
                bbox = [float(value) for value in track.get("bbox", [])]
                if len(bbox) != 4 or bbox[2] < 12 or bbox[3] < 24:
                    continue
                score = float(track.get("detectionConfidence", 0.0))
                observations.setdefault(int(track["trackId"]), []).append(
                    (frame_position, bbox, score)
                )

        embeddings: dict[int, list[float]] = {}
        for track_id, items in observations.items():
            selected = _representative_observations(items, _MAX_CROPS_PER_TRACK)
            features: list[np.ndarray] = []
            for frame_position, bbox, _score in selected:
                crop = _crop_person(frame_loader(frame_position), bbox)
                if crop is None:
                    continue
                feature = self._infer(crop)
                if feature.size:
                    features.append(feature)
            if not features:
                continue
            aggregate = np.mean(np.stack(features), axis=0)
            norm = float(np.linalg.norm(aggregate))
            if norm <= np.finfo(np.float32).eps:
                continue
            normalized = aggregate / norm
            embeddings[track_id] = [round(float(value), 6) for value in normalized]
        return embeddings

    def _infer(self, image_rgb: np.ndarray) -> np.ndarray:
        if self._net is None:
            raise RuntimeError("Person ReID model is not loaded")
        import cv2

        resized = cv2.resize(image_rgb, _INPUT_SIZE, interpolation=cv2.INTER_LINEAR)
        normalized = (resized.astype(np.float32) / 255.0 - _MEAN) / _STD
        blob = cv2.dnn.blobFromImage(normalized)
        self._net.setInput(blob)
        feature = np.asarray(self._net.forward(), dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(feature))
        return feature / norm if norm > np.finfo(np.float32).eps else feature


def _representative_observations(
    observations: list[tuple[int, list[float], float]],
    limit: int,
) -> list[tuple[int, list[float], float]]:
    if len(observations) <= limit:
        return observations
    positions = {0, len(observations) // 2, len(observations) - 1}
    selected = [observations[index] for index in sorted(positions)]
    return sorted(selected, key=lambda item: item[2], reverse=True)[:limit]


def _crop_person(frame: np.ndarray, bbox: list[float]) -> np.ndarray | None:
    height, width = frame.shape[:2]
    x, y, box_width, box_height = bbox
    pad_x = box_width * 0.04
    pad_y = box_height * 0.02
    x1 = max(0, int(x - pad_x))
    y1 = max(0, int(y - pad_y))
    x2 = min(width, int(x + box_width + pad_x))
    y2 = min(height, int(y + box_height + pad_y))
    if x2 - x1 < 12 or y2 - y1 < 24:
        return None
    return np.ascontiguousarray(frame[y1:y2, x1:x2])


def _default_hf_cache_path() -> Path:
    """Return the pinned model path in the user's default HF cache.

    Worker deployments sometimes override ``HF_HOME`` for larger local models.
    Checking the conventional user cache first lets a previously downloaded
    lightweight ReID asset be reused instead of storing a second copy.
    """

    repository_folder = f"models--{PERSON_REID_REPO.replace('/', '--')}"
    return (
        Path.home()
        / ".cache"
        / "huggingface"
        / "hub"
        / repository_folder
        / "snapshots"
        / PERSON_REID_REVISION
        / Path(PERSON_REID_FILENAME)
    )
