"""
threshold_detector.py : Cross-distortion threshold detection & comparison.

Aggregates the headline transition points across every distortion type: the
hallucination threshold, the collapse point, and the first level at which the
model leaves stable perception ("first drift"). It also ranks the distortions to
name the *most dangerous* one, the distortion that induces hallucination
earliest (ties broken by how fast it then collapses).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import config
from analysis.failure_dynamics import FailureAnalysis, FailureDynamicsAnalyzer


@dataclass
class ThresholdReport:
    """Cross-distortion summary of the key failure transition points."""

    hallucination_thresholds: dict[str, int | None] = field(default_factory=dict)
    collapse_points: dict[str, int | None] = field(default_factory=dict)
    first_drift: dict[str, int | None] = field(default_factory=dict)
    most_dangerous_distortion: str | None = None
    earliest_hallucination_level: int | None = None


class ThresholdDetector:
    """Locate and compare failure thresholds across all distortion types."""

    def __init__(self) -> None:
        self._analyzer = FailureDynamicsAnalyzer()

    def find_all_thresholds(self, experiment_metrics: dict) -> ThresholdReport:
        """Build a :class:`ThresholdReport` from a full ``metrics.json`` dict.

        Args:
            experiment_metrics: The metrics payload with a ``"distortions"`` map
                of ``{distortion_type: metrics_block}``.

        Returns:
            A :class:`ThresholdReport` with per-type thresholds and the overall
            most-dangerous distortion.
        """
        distortions: dict[str, dict] = experiment_metrics.get("distortions", {})

        analyses: list[FailureAnalysis] = []
        report = ThresholdReport()

        for dtype, block in distortions.items():
            analysis = self._analyzer.analyze({**block, "distortion_type": dtype})
            analyses.append(analysis)

            report.hallucination_thresholds[dtype] = (
                analysis.hallucination_threshold_level
            )
            report.collapse_points[dtype] = analysis.collapse_point_level
            report.first_drift[dtype] = self._first_drift(block.get("levels", []))

        report.most_dangerous_distortion = self.compare_distortions(analyses)

        # Earliest hallucination level across all distortions.
        hall_levels = [
            a.hallucination_threshold_level
            for a in analyses
            if a.hallucination_threshold_level is not None
        ]
        report.earliest_hallucination_level = min(hall_levels) if hall_levels else None

        return report

    def compare_distortions(self, analyses: list[FailureAnalysis]) -> str | None:
        """Return the most dangerous distortion name.

        Primary key: earliest hallucination onset (lower level == more
        dangerous). Ties are broken by collapse speed, an earlier collapse
        point first, then a steeper confidence collapse rate. When nothing
        hallucinated, falls back to the highest peak hallucination score.
        """
        if not analyses:
            return None

        hallucinators = [
            a for a in analyses if a.hallucination_threshold_level is not None
        ]
        if hallucinators:
            best = min(hallucinators, key=self._danger_key)
            return best.distortion_type

        # No hallucination anywhere, most dangerous == highest peak score.
        return max(analyses, key=lambda a: a.peak_hallucination_score).distortion_type

    @staticmethod
    def _danger_key(analysis: FailureAnalysis) -> tuple:
        """Sort key: earliest hallucination, then earliest/steepest collapse."""
        collapse_level = (
            analysis.collapse_point_level
            if analysis.collapse_point_level is not None
            else float("inf")
        )
        return (
            analysis.hallucination_threshold_level,
            collapse_level,
            -analysis.confidence_collapse_rate,
        )

    @staticmethod
    def _first_drift(levels: list[dict]) -> int | None:
        """First level leaving stable perception (wer>=0.05 or confidence<=85)."""
        for i, lv in enumerate(levels):
            wer = float(lv.get("wer", 0.0))
            conf = float(lv.get("confidence", 0.0))
            if not (wer < 0.05 and conf > 85):
                return i
        return None
