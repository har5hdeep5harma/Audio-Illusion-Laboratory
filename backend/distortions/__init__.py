"""distortions : the distortion engine.

Each module implements one controlled degradation as a :class:`BaseDistortion`,
mapping an intensity to a transformed waveform (see context.md §8 and base.py).
Level 0 is always the clean baseline (identity).

This package also exposes a registry so callers (e.g. the /api/distort route) can
resolve a :class:`DistortionType` to a ready-to-use distortion instance.
"""

from __future__ import annotations

from .base import BaseDistortion, DistortionLevel, DistortionType
from .combined import CombinedDistortion
from .compression import CompressionDistortion
from .echo import EchoDistortion
from .noise import WhiteNoiseDistortion
from .pitch import PitchDistortion
from .speed import SpeedDistortion

# Singleton instances, every distortion is stateless (noise reseeds per call).
_REGISTRY: dict[DistortionType, BaseDistortion] = {
    DistortionType.WHITE_NOISE: WhiteNoiseDistortion(),
    DistortionType.ECHO: EchoDistortion(),
    DistortionType.COMPRESSION: CompressionDistortion(),
    DistortionType.SPEED_SHIFT: SpeedDistortion(),
    DistortionType.PITCH_SHIFT: PitchDistortion(),
    DistortionType.COMBINED: CombinedDistortion(),
}


def get_distortion(distortion_type: DistortionType) -> BaseDistortion:
    """Return the distortion instance for ``distortion_type``."""
    return _REGISTRY[distortion_type]


def all_distortions() -> list[BaseDistortion]:
    """Return one instance of every registered distortion."""
    return list(_REGISTRY.values())


__all__ = [
    "BaseDistortion",
    "DistortionLevel",
    "DistortionType",
    "WhiteNoiseDistortion",
    "EchoDistortion",
    "CompressionDistortion",
    "SpeedDistortion",
    "PitchDistortion",
    "CombinedDistortion",
    "get_distortion",
    "all_distortions",
]
