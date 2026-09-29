"""
resampler.py : Resample arbitrary audio to the canonical 16 kHz mono source.

Down-mixes to mono, resamples to the target rate (default SAMPLE_RATE = 16 kHz)
via ``librosa.resample``, and peak-normalizes the amplitude into [-1.0, 1.0].
The result is the single canonical signal the distortion engine and Whisper
consume; it is written out as ``original_16k.wav`` by the upload route.
"""

from __future__ import annotations

import librosa
import numpy as np

import config


class AudioResampler:
    """Convert decoded audio to mono, 16 kHz, peak-normalized float32."""

    def resample(
        self,
        audio: np.ndarray,
        original_sr: int,
        target_sr: int = config.SAMPLE_RATE,
    ) -> np.ndarray:
        """Resample audio to ``target_sr`` mono and normalize to [-1.0, 1.0].

        Args:
            audio: Float waveform. Mono ``(n_samples,)`` or multichannel
                ``(n_channels, n_samples)`` (librosa convention).
            original_sr: Sample rate of the input audio, in Hz.
            target_sr: Desired output sample rate, in Hz (default 16 kHz).

        Returns:
            A 1-D float32 array at ``target_sr``, peak-normalized to [-1, 1].

        Raises:
            ValueError: If ``original_sr`` or ``target_sr`` is non-positive, or
                the input array is empty.
        """
        if original_sr <= 0:
            raise ValueError(f"original_sr must be positive, got {original_sr}")
        if target_sr <= 0:
            raise ValueError(f"target_sr must be positive, got {target_sr}")

        mono = self._to_mono(audio)
        if mono.size == 0:
            raise ValueError("Cannot resample empty audio array.")

        # Resample only when the rate actually differs.
        if original_sr != target_sr:
            mono = librosa.resample(
                mono, orig_sr=original_sr, target_sr=target_sr
            )

        return self._normalize(mono)

    @staticmethod
    def _to_mono(audio: np.ndarray) -> np.ndarray:
        """Down-mix to mono by averaging channels; returns float32 1-D array."""
        arr = np.asarray(audio, dtype=np.float32)
        if arr.ndim == 1:
            return arr
        if arr.ndim == 2:
            # librosa uses (channels, samples); average across channels.
            return arr.mean(axis=0).astype(np.float32, copy=False)
        raise ValueError(
            f"Unexpected audio array with {arr.ndim} dimensions; "
            "expected 1 (mono) or 2 (multichannel)."
        )

    @staticmethod
    def _normalize(audio: np.ndarray) -> np.ndarray:
        """Peak-normalize into [-1.0, 1.0]; silence is returned unchanged."""
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0.0:
            audio = audio / peak
        return np.clip(audio, -1.0, 1.0).astype(np.float32, copy=False)
