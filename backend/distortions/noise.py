"""
noise.py : Additive white-noise distortion.

Adds zero-mean Gaussian noise whose standard deviation scales with the signal's
own amplitude (``intensity * std(audio)``), so the perceptual SNR degrades
predictably as intensity climbs. The noise is drawn from a fixed-seed generator
so a given (length, intensity) always yields the same variant, distortions must
be repeatable (context.md §1).
"""

from __future__ import annotations

import numpy as np

from .base import BaseDistortion, DistortionLevel, DistortionType

# Fixed seed → repeatable noise for identical inputs.
_NOISE_SEED = 42


class WhiteNoiseDistortion(BaseDistortion):
    """Additive Gaussian noise across 9 levels (0%–80% of signal std)."""

    # 0.0, 0.1, ... 0.8
    _INTENSITIES = [round(0.1 * i, 1) for i in range(9)]

    @property
    def name(self) -> str:
        return "white_noise"

    @property
    def distortion_type(self) -> DistortionType:
        return DistortionType.WHITE_NOISE

    def get_levels(self) -> list[DistortionLevel]:
        return [
            DistortionLevel(
                level_index=i,
                intensity=intensity,
                label=f"{int(round(intensity * 100))}% noise",
            )
            for i, intensity in enumerate(self._INTENSITIES)
        ]

    def apply(self, audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
        audio = self._as_float32(audio)
        if intensity <= 0.0:
            return audio.copy()

        std = float(np.std(audio))
        if std == 0.0:  # silence — nothing to perturb relative to
            return audio.copy()

        rng = np.random.default_rng(_NOISE_SEED)
        noise = rng.normal(0.0, intensity * std, size=audio.shape).astype(np.float32)
        return self._clip(audio + noise)
