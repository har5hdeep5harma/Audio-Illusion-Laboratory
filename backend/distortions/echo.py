"""
echo.py : Echo / room-reflection distortion.

Approximates room echo by convolving the signal with a sparse impulse response
(IR): a unit direct-path tap plus a few exponentially-decaying delayed taps. The
delay and decay grow with level (delay 0.05s→0.4s, decay 0.10→0.70). Level 0 is a
clean passthrough. Convolution is done with ``scipy.signal.fftconvolve``.

``intensity`` here is the level index (table-based distortion, see base.py).
"""

from __future__ import annotations

import numpy as np
from scipy.signal import fftconvolve

from .base import BaseDistortion, DistortionLevel, DistortionType

# Per-level (delay_seconds, decay). Level 0 == no echo (passthrough).
_PARAMS: list[tuple[float, float]] = [
    (0.00, 0.00),
    (0.05, 0.10),
    (0.10, 0.20),
    (0.15, 0.30),
    (0.20, 0.45),
    (0.30, 0.60),
    (0.40, 0.70),
]
# Number of decaying reflections in the impulse response (room-echo tail).
_N_REFLECTIONS = 3


class EchoDistortion(BaseDistortion):
    """Room-echo via sparse-IR convolution across 7 levels."""

    @property
    def name(self) -> str:
        return "echo"

    @property
    def distortion_type(self) -> DistortionType:
        return DistortionType.ECHO

    def get_levels(self) -> list[DistortionLevel]:
        levels = []
        for i, (delay_s, decay) in enumerate(_PARAMS):
            label = "No echo" if i == 0 else f"{int(delay_s * 1000)}ms / decay {decay:.2f}"
            levels.append(DistortionLevel(level_index=i, intensity=float(i), label=label))
        return levels

    def apply(self, audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
        audio = self._as_float32(audio)
        idx = self._nearest_level_index(intensity)
        delay_s, decay = _PARAMS[idx]

        delay = int(delay_s * sr)
        if delay <= 0 or decay <= 0.0:
            return audio.copy()  # passthrough

        # Build a sparse impulse response: direct path + decaying reflections.
        ir = np.zeros(delay * _N_REFLECTIONS + 1, dtype=np.float32)
        ir[0] = 1.0
        for k in range(1, _N_REFLECTIONS + 1):
            ir[delay * k] = decay**k

        wet = fftconvolve(audio, ir)[: len(audio)].astype(np.float32)
        return self._clip(wet)
