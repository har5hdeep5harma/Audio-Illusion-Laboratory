"""
compression.py : Bit-depth reduction + mu-law companding distortion.

Simulates lossy telephony/codec degradation in two stages that intensify with
level: (1) uniform quantization emulating bit-depth reduction (16-bit down to
4-bit at the maximum level) and (2) mu-law companding at the higher levels, which
coarsens loud samples and crushes quiet detail. Level 0 is original quality.

Mu-law companding is implemented directly with numpy (the mu-law transform is not
provided by scipy.signal); the output is peak-normalized so levels stay loudness-
comparable. ``intensity`` is the level index (table-based distortion, see base).
"""

from __future__ import annotations

import numpy as np

from .base import BaseDistortion, DistortionLevel, DistortionType

# Per-level (bits, mu). bits == 16 and mu == 0 means "no change". mu == 0 disables
# companding for that level.
_PARAMS: list[tuple[int, float]] = [
    (16, 0.0),     # 0: original quality
    (12, 0.0),     # 1: mild bit reduction
    (10, 0.0),     # 2
    (8, 0.0),      # 3: 8-bit
    (8, 64.0),     # 4: 8-bit + companding
    (6, 128.0),    # 5
    (4, 255.0),    # 6: 4-bit + heavy companding (telephony-grade)
]


class CompressionDistortion(BaseDistortion):
    """Quantization + mu-law companding across 7 levels."""

    @property
    def name(self) -> str:
        return "compression"

    @property
    def distortion_type(self) -> DistortionType:
        return DistortionType.COMPRESSION

    def get_levels(self) -> list[DistortionLevel]:
        levels = []
        for i, (bits, mu) in enumerate(_PARAMS):
            if i == 0:
                label = "Original quality"
            elif mu > 0:
                label = f"{bits}-bit + mu-law (mu={int(mu)})"
            else:
                label = f"{bits}-bit"
            levels.append(DistortionLevel(level_index=i, intensity=float(i), label=label))
        return levels

    def apply(self, audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
        audio = self._as_float32(audio)
        idx = self._nearest_level_index(intensity)
        bits, mu = _PARAMS[idx]

        if bits >= 16 and mu <= 0.0:
            return audio.copy()  # passthrough

        x = np.clip(audio, -1.0, 1.0)

        # 1. Mu-law compress (companding) on the [-1, 1] signal.
        if mu > 0.0:
            x = self._mu_law_compress(x, mu)

        # 2. Uniform quantization → emulate bit-depth reduction.
        x = self._quantize(x, bits)

        # 3. Mu-law expand to return to the linear domain.
        if mu > 0.0:
            x = self._mu_law_expand(x, mu)

        return self._clip(self._peak_normalize(x))

    @staticmethod
    def _mu_law_compress(x: np.ndarray, mu: float) -> np.ndarray:
        return np.sign(x) * np.log1p(mu * np.abs(x)) / np.log1p(mu)

    @staticmethod
    def _mu_law_expand(y: np.ndarray, mu: float) -> np.ndarray:
        return np.sign(y) * (1.0 / mu) * (np.power(1.0 + mu, np.abs(y)) - 1.0)

    @staticmethod
    def _quantize(x: np.ndarray, bits: int) -> np.ndarray:
        """Quantize a [-1, 1] signal to ``bits`` of resolution."""
        levels = 2**bits
        # Map [-1, 1] → [0, levels-1], round, map back.
        q = np.round((x + 1.0) * 0.5 * (levels - 1))
        return (q / (levels - 1)) * 2.0 - 1.0
