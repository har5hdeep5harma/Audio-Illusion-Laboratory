"""
generator.py : Experiment Report Generator.

Assembles per-distortion :class:`FailureAnalysis` results into a single
:class:`ExperimentReport`: per-distortion summaries, the most dangerous and
earliest-hallucinating distortions, an overall robustness grade, and a plain-
English executive summary. This is the top of the intelligence stack, it turns
analysis into a human-readable scientific finding.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from analysis.failure_dynamics import FailureAnalysis, FailureStage
from analysis.threshold_detector import ThresholdDetector

# Robustness severity ranking (higher == worse) for aggregating across types.
_ROBUSTNESS_SEVERITY = {"high": 0, "moderate": 1, "low": 2, "critical": 3}


@dataclass
class DistortionReport:
    """Report section summarizing one distortion type."""

    distortion_type: str
    overall_robustness: str
    hallucination_threshold_level: int | None
    hallucination_threshold_intensity: float | None
    collapse_point_level: int | None
    collapse_confidence: float | None
    confidence_collapse_rate: float
    peak_hallucination_score: float
    failure_path: list[str]
    stages: list[FailureStage]


@dataclass
class ExperimentReport:
    """The full assembled report for an experiment."""

    experiment_id: str
    filename: str
    duration_seconds: float
    distortions_tested: list[str]
    per_distortion: list[DistortionReport]
    most_dangerous_distortion: str
    earliest_hallucination_distortion: str
    earliest_hallucination_level: int
    overall_robustness: str
    executive_summary: str  # 2-3 sentence plain-English summary
    generated_at: str  # ISO timestamp


class ReportGenerator:
    """Build an :class:`ExperimentReport` from per-distortion analyses."""

    def __init__(self) -> None:
        self._threshold_detector = ThresholdDetector()

    def generate(
        self,
        experiment_id: str,
        analyses: list[FailureAnalysis],
        metadata: dict,
    ) -> ExperimentReport:
        """Assemble the full report for an experiment."""
        per_distortion = [self._distortion_report(a) for a in analyses]

        most_dangerous = (
            self._threshold_detector.compare_distortions(analyses) or "none"
        )
        earliest_dist, earliest_level = self._earliest_hallucination(analyses)
        overall = self._aggregate_robustness(analyses)

        report = ExperimentReport(
            experiment_id=experiment_id,
            filename=metadata.get("original_filename", "unknown"),
            duration_seconds=float(metadata.get("duration_seconds", 0.0)),
            distortions_tested=[a.distortion_type for a in analyses],
            per_distortion=per_distortion,
            most_dangerous_distortion=most_dangerous,
            earliest_hallucination_distortion=earliest_dist,
            earliest_hallucination_level=earliest_level,
            overall_robustness=overall,
            executive_summary="",  # filled below
            generated_at=datetime.now(timezone.utc).isoformat(),
        )
        report.executive_summary = self.generate_executive_summary(report)
        return report

    def generate_executive_summary(self, report: ExperimentReport) -> str:
        """Produce a 2-3 sentence plain-English summary of the findings."""
        sentences: list[str] = []

        resistant = [
            d.distortion_type
            for d in report.per_distortion
            if d.hallucination_threshold_level is None
        ]

        if report.earliest_hallucination_level >= 0:
            hall_dist = self._humanize(report.earliest_hallucination_distortion)
            if resistant:
                held = self._join_names([self._humanize(r) for r in resistant])
                sentences.append(
                    f"The model maintained stable perception under {held}, but "
                    f"hallucinated under {hall_dist} at level "
                    f"{report.earliest_hallucination_level}."
                )
            else:
                sentences.append(
                    f"The model began hallucinating under {hall_dist} as early as "
                    f"level {report.earliest_hallucination_level}."
                )
        else:
            sentences.append(
                "The model resisted hallucination across every distortion tested."
            )

        fastest = self._fastest_collapse(report.per_distortion)
        if fastest is not None:
            sentences.append(
                f"{self._humanize(fastest).capitalize()} distortions caused the "
                "fastest confidence collapse."
            )

        sentences.append(
            f"Overall robustness is classified as {report.overall_robustness}."
        )
        return " ".join(sentences)

    # helpers
    @staticmethod
    def _distortion_report(a: FailureAnalysis) -> DistortionReport:
        return DistortionReport(
            distortion_type=a.distortion_type,
            overall_robustness=a.overall_robustness,
            hallucination_threshold_level=a.hallucination_threshold_level,
            hallucination_threshold_intensity=a.hallucination_threshold_intensity,
            collapse_point_level=a.collapse_point_level,
            collapse_confidence=a.collapse_confidence,
            confidence_collapse_rate=a.confidence_collapse_rate,
            peak_hallucination_score=a.peak_hallucination_score,
            failure_path=a.failure_path,
            stages=a.failure_stages,
        )

    @staticmethod
    def _earliest_hallucination(analyses: list[FailureAnalysis]) -> tuple[str, int]:
        """Return (distortion_type, level) of the earliest hallucination.

        Falls back to ("none", -1) when nothing hallucinated.
        """
        hallucinators = [
            a for a in analyses if a.hallucination_threshold_level is not None
        ]
        if not hallucinators:
            return "none", -1
        earliest = min(hallucinators, key=lambda a: a.hallucination_threshold_level)
        return earliest.distortion_type, int(earliest.hallucination_threshold_level)

    @staticmethod
    def _aggregate_robustness(analyses: list[FailureAnalysis]) -> str:
        """Overall robustness == the worst (most severe) per-distortion grade."""
        if not analyses:
            return "high"
        worst = max(
            analyses,
            key=lambda a: _ROBUSTNESS_SEVERITY.get(a.overall_robustness, 0),
        )
        return worst.overall_robustness

    @staticmethod
    def _fastest_collapse(reports: list[DistortionReport]) -> str | None:
        """Distortion with the steepest confidence collapse rate, if any fell."""
        collapsing = [r for r in reports if r.confidence_collapse_rate > 0]
        if not collapsing:
            return None
        return max(collapsing, key=lambda r: r.confidence_collapse_rate).distortion_type

    @staticmethod
    def _humanize(name: str) -> str:
        """`WHITE_NOISE` → `white noise`."""
        return name.replace("_", " ").lower()

    @staticmethod
    def _join_names(names: list[str]) -> str:
        """Join names into a readable list (`a`, `a and b`, `a, b, and c`)."""
        if not names:
            return "lighter distortions"
        if len(names) == 1:
            return names[0]
        if len(names) == 2:
            return f"{names[0]} and {names[1]}"
        return f"{', '.join(names[:-1])}, and {names[-1]}"
