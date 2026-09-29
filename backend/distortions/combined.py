"""
combined.py : Escalating composite distortion.

Stacks noise, echo, and compression in sequence to probe compound failure modes
that no single distortion reproduces. Six levels escalate from clean to severe.
Only length-preserving distortions are combined (no speed/pitch), so every
variant stays time-aligned with the clean baseline.

``intensity`` is the level index (table/recipe distortion, see base.py).
"""

from __future__ import annotations

import numpy as np

from .base import BaseDistortion, DistortionLevel, DistortionType
from .compression import CompressionDistortion
from .echo import EchoDistortion
from .noise import WhiteNoiseDistortion

# Per-level recipe. Each entry: (noise_fraction, echo_level, compression_level).
# A value of None / 0 skips that stage.
#   echo levels reference echo._PARAMS indices; compression levels reference
#   compression._PARAMS indices.
_RECIPES: list[tuple[float, int, int]] = [
    (0.00, 0, 0),  # 0: clean
    (0.10, 1, 0),  # 1: light noise + very light echo
    (0.20, 2, 0),  # 2: noise + light echo
    (0.30, 3, 2),  # 3: noise + medium echo + light compression
    (0.40, 4, 4),  # 4: noise + medium echo + medium compression
    (0.50, 6, 6),  # 5: noise + heavy echo + heavy compression
]

_LABELS = [
    "Clean",
    "Light: 10% noise + faint echo",
    "Mild: 20% noise + light echo",
    "Moderate: 30% noise + echo + light compression",
    "Heavy: 40% noise + echo + medium compression",
    "Severe: 50% noise + heavy echo + heavy compression",
]


class CombinedDistortion(BaseDistortion):
    """Sequential noise → echo → compression composite across 6 levels."""

    def __init__(self) -> None:
        self._noise = WhiteNoiseDistortion()
        self._echo = EchoDistortion()
        self._compression = CompressionDistortion()

    @property
    def name(self) -> str:
        return "combined"

    @property
    def distortion_type(self) -> DistortionType:
        return DistortionType.COMBINED

    def get_levels(self) -> list[DistortionLevel]:
        return [
            DistortionLevel(level_index=i, intensity=float(i), label=_LABELS[i])
            for i in range(len(_RECIPES))
        ]

    def apply(self, audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
        audio = self._as_float32(audio)
        idx = self._nearest_level_index(intensity)
        noise_frac, echo_level, comp_level = _RECIPES[idx]

        if noise_frac <= 0.0 and echo_level == 0 and comp_level == 0:
            return audio.copy()  # clean baseline

        out = audio
        if noise_frac > 0.0:
            out = self._noise.apply(out, sr, noise_frac)
        if echo_level > 0:
            out = self._echo.apply(out, sr, float(echo_level))
        if comp_level > 0:
            out = self._compression.apply(out, sr, float(comp_level))

        return self._clip(self._as_float32(out))
