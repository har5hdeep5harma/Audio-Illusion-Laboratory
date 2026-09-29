"""
base.py : Distortion engine core: types, level descriptors, and the interface.

Every distortion is a controlled, repeatable degradation that maps an *intensity*
to a transformed waveform. Two families of distortion share this interface:

  * **Parametric** (noise, speed, pitch): ``intensity`` is the meaningful scalar
    parameter itself, a noise fraction, a time-stretch rate, a semitone count.
  * **Table / recipe** (echo, compression, combined): ``intensity`` is the level
    index; ``apply`` looks the concrete parameters up from an internal table.
    A standalone caller may pass any value, it is rounded to the nearest level.

All audio is float32, mono, 16 kHz throughout. Level 0 is always a clean
passthrough (identity) so the baseline is comparable to every variant.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

import numpy as np


class DistortionType(str, Enum):
    """Identifiers for every distortion the engine can synthesize."""

    WHITE_NOISE = "WHITE_NOISE"
    ECHO = "ECHO"
    COMPRESSION = "COMPRESSION"
    SPEED_SHIFT = "SPEED_SHIFT"
    PITCH_SHIFT = "PITCH_SHIFT"
    COMBINED = "COMBINED"


@dataclass(frozen=True)
class DistortionLevel:
    """A single point on a distortion's intensity ladder.

    Attributes:
        level_index: Position on the ladder (0 == clean baseline).
        intensity: The value handed to ``apply`` for this level. Its meaning is
            distortion-specific (see module docstring).
        label: Human-readable description for UI / manifest.
    """

    level_index: int
    intensity: float
    label: str


class BaseDistortion(ABC):
    """Abstract controlled audio degradation."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Short human-readable name of this distortion."""

    @property
    @abstractmethod
    def distortion_type(self) -> DistortionType:
        """The :class:`DistortionType` this implements."""

    @abstractmethod
    def get_levels(self) -> list[DistortionLevel]:
        """Return the ordered intensity ladder (index 0 == clean baseline)."""

    @abstractmethod
    def apply(self, audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
        """Return a distorted float32 copy of ``audio`` for ``intensity``.

        Args:
            audio: Mono float32 waveform in [-1, 1].
            sr: Sample rate in Hz (canonical 16 kHz).
            intensity: Distortion strength (see module docstring for meaning).

        Returns:
            A float32 waveform. Length may differ from the input for
            time-warping distortions (speed).
        """

    # shared helpers
    @staticmethod
    def _as_float32(audio: np.ndarray) -> np.ndarray:
        """Return a contiguous float32 view/copy of ``audio``."""
        return np.ascontiguousarray(audio, dtype=np.float32)

    @staticmethod
    def _clip(audio: np.ndarray) -> np.ndarray:
        """Clip into [-1.0, 1.0] as float32."""
        return np.clip(audio, -1.0, 1.0).astype(np.float32, copy=False)

    @staticmethod
    def _peak_normalize(audio: np.ndarray) -> np.ndarray:
        """Scale so the peak magnitude is 1.0; silence is returned unchanged."""
        audio = np.asarray(audio, dtype=np.float32)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0.0:
            audio = audio / peak
        return audio.astype(np.float32, copy=False)

    def _nearest_level_index(self, intensity: float) -> int:
        """Round ``intensity`` to the nearest valid level index for this ladder."""
        levels = self.get_levels()
        idx = int(round(intensity))
        return max(0, min(idx, len(levels) - 1))
