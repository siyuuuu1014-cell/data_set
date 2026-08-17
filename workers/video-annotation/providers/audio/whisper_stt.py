"""Whisper speech-to-text provider — transcribe video audio.

Whisper tiny: ~150MB disk, <1GB VRAM.
Extracts audio from video via ffmpeg, then transcribes.
"""

from __future__ import annotations

import logging
import subprocess
import os
import tempfile
from typing import Any

import torch

from config import DEVICE, FFMPEG_PATH, WHISPER_MODEL
from providers.registry import model_load_kwargs, resolve_model_reference

logger = logging.getLogger(__name__)

class WhisperSTTProvider:
    """Transcribe video audio to text."""

    def __init__(self, model_name: str | None = None) -> None:
        self._model_name = model_name or WHISPER_MODEL
        self._processor: Any = None
        self._model: Any = None
        self._loaded = False

    def load(self) -> None:
        from transformers import WhisperProcessor, WhisperForConditionalGeneration

        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        model_ref = resolve_model_reference("whisper", self._model_name)
        logger.info("Loading Whisper STT: %s", model_ref)
        load_kwargs = model_load_kwargs("whisper", model_ref)

        self._processor = WhisperProcessor.from_pretrained(
            model_ref, **load_kwargs
        )
        self._model = WhisperForConditionalGeneration.from_pretrained(
            model_ref, **load_kwargs
        )
        self._model.eval()
        if DEVICE == "cuda":
            self._model = self._model.to(DEVICE)
        self._loaded = True
        logger.info("Whisper STT loaded on %s", DEVICE)

    def unload(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
        if self._processor is not None:
            del self._processor
            self._processor = None
        self._loaded = False
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        logger.info("Whisper STT unloaded")

    def transcribe(self, video_path: str, start: float = 0, end: float = 0) -> dict:
        """Extract audio from video segment and transcribe.

        Returns {"text": "..."} when speech is recognized, otherwise an empty
        dict. Failures are raised so the pipeline can report them separately
        from a successful run with no speech.
        Timestamped segments are not produced by the current generation path.
        """
        if not self._loaded:
            self.load()

        temp_wav: str | None = None
        try:
            # Extract audio from video segment via ffmpeg
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                temp_wav = temp_file.name
            cmd = [
                FFMPEG_PATH,
                "-ss", str(start),
                "-i", video_path,
                "-t", str(end - start) if end > start else "60",
                "-vn",                            # no video
                "-acodec", "pcm_s16le",           # 16-bit PCM
                "-ar", "16000",                   # 16kHz (whisper native)
                "-ac", "1",                       # mono
                temp_wav,
                "-y",
            ]
            completed = subprocess.run(cmd, capture_output=True, check=False, timeout=120)
            if completed.returncode != 0:
                stderr = completed.stderr.decode("utf-8", errors="replace").strip()
                raise RuntimeError(stderr or f"ffmpeg exited with code {completed.returncode}")

            if not os.path.exists(temp_wav) or os.path.getsize(temp_wav) < 1000:
                logger.warning("Whisper: audio extraction produced no usable data")
                return {}

            from scipy.io import wavfile
            import numpy as np

            sample_rate, audio_array = wavfile.read(temp_wav)
            if audio_array.ndim > 1:
                audio_array = audio_array.mean(axis=1)  # stereo → mono
            audio_array = audio_array.astype(np.float32) / 32768.0  # int16 → float32 [-1,1]

            if len(audio_array) < 1600:  # <0.1 seconds
                logger.warning("Whisper: audio too short")
                return {}

            input_features = self._processor(
                audio_array, sampling_rate=sample_rate, return_tensors="pt"
            ).input_features

            if DEVICE == "cuda":
                input_features = input_features.to(DEVICE)

            with torch.inference_mode():
                generated_ids = self._model.generate(
                    input_features,
                    max_length=448,
                    task="transcribe",
                )

            text = self._processor.batch_decode(
                generated_ids, skip_special_tokens=True
            )[0].strip()

            if not text or text in ("", "."):
                return {}

            logger.info("Whisper detected: %.300s", text)
            return {"text": text}

        except Exception as e:
            logger.warning("Whisper STT failed: %s (%s)", type(e).__name__, e)
            if isinstance(e, RuntimeError):
                raise
            raise RuntimeError(f"Whisper STT inference failed: {e}") from e
        finally:
            if temp_wav and os.path.exists(temp_wav):
                try:
                    os.unlink(temp_wav)
                except OSError:
                    pass
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
