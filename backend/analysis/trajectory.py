"""
trajectory.py : Build per-distortion metric trajectories across levels.

Assembles ordered series (one per distortion type) of metric points across
DISTORTION_LEVELS for charting the progression through the failure stages on the
dashboard/observatory.
"""

from __future__ import annotations

# def build_trajectories(metric_rows: list[dict]) -> list[dict]:
#     """Group metric rows by distortion into ordered, per-level series."""
#     raise NotImplementedError
