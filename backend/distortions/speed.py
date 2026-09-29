"""
speed.py : Time-stretch (speed) distortion.

Changes playback speed without altering pitch via ``librosa.effects.time_stretch``
(phase vocoder). ``intensity`` is the stretch *rate*: >1.0 speeds up (shorter
output), <1.0 slows down (longer output). Level 0 is 1.0x (passthrough). Output
length therefore varies by level, this is expected and downstream code aligns
transcripts against the clean baseline regardless of length.
"""

from __future__ import annotations

import librosa
import numpy as np

from .base import BaseDistortion, DistortionLevel, DistortionType

# intensity == time_stretch rate.
_RATES = [1.0, 0.85, 0.90, 0.95, 1.05, 1.10, 1.20]


class SpeedDistortion(BaseDistortion):
    """Phase-vocoder time-stretch across 7 rates."""

    @property
    def name(self) -> str:
        return "speed_shift"

    @property
    def distortion_type(self) -> DistortionType:
        return DistortionType.SPEED_SHIFT

    def get_levels(self) -> list[DistortionLevel]:
        return [
            DistortionLevel(
                level_index=i,
                intensity=rate,
                label="1.00x (original)" if rate == 1.0 else f"{rate:.2f}x speed",
            )
            for i, rate in enumerate(_RATES)
        ]

    def apply(self, audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
        audio = self._as_float32(audio)
        if intensity == 1.0 or intensity <= 0.0:
            return audio.copy()  # passthrough
        # Phase-vocoder needs at least one analysis frame; for very short clips
        # (<~1 frame) the transform can fail, so fall back to a passthrough.
        if audio.shape[0] < 2048:
            return audio.copy()
        try:
            stretched = librosa.effects.time_stretch(audio, rate=float(intensity))
        except Exception:  # noqa: BLE001 — degenerate input → leave audio unchanged
            return audio.copy()
        return self._as_float32(stretched)
