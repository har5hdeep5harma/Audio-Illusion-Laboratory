"""
pitch.py : Pitch-shift distortion.

Shifts pitch by a number of semitones while preserving duration via
``librosa.effects.pitch_shift``. ``intensity`` is the semitone count (may be
negative to shift down). Level 0 is 0 semitones (passthrough). The level ladder
alternates direction to probe both upward and downward shifts.
"""

from __future__ import annotations

import librosa
import numpy as np

from .base import BaseDistortion, DistortionLevel, DistortionType

# intensity == semitone shift.
_SEMITONES = [0, -2, -1, +1, +2, +3, -3]


class PitchDistortion(BaseDistortion):
    """Length-preserving pitch shift across 7 semitone offsets."""

    @property
    def name(self) -> str:
        return "pitch_shift"

    @property
    def distortion_type(self) -> DistortionType:
        return DistortionType.PITCH_SHIFT

    def get_levels(self) -> list[DistortionLevel]:
        return [
            DistortionLevel(
                level_index=i,
                intensity=float(semitones),
                label="0 st (original)" if semitones == 0 else f"{semitones:+d} semitones",
            )
            for i, semitones in enumerate(_SEMITONES)
        ]

    def apply(self, audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
        audio = self._as_float32(audio)
        if intensity == 0.0:
            return audio.copy()  # passthrough
        # Pitch-shift relies on the STFT; very short clips have no full frame and
        # would raise, so fall back to a passthrough for sub-frame audio.
        if audio.shape[0] < 2048:
            return audio.copy()
        try:
            shifted = librosa.effects.pitch_shift(audio, sr=sr, n_steps=float(intensity))
        except Exception:  # noqa: BLE001 — degenerate input → leave audio unchanged
            return audio.copy()
        return self._as_float32(shifted)
