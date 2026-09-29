"""
failure_dynamics.py : Failure Dynamics Analysis.

Turns one distortion type's per-level metrics into a structured
:class:`FailureAnalysis`: the failure stage at every level, the hallucination
threshold and collapse point, how fast confidence fell, the peak hallucination
score, an overall robustness grade, and the human-readable failure path.

Stage classification applies the terminal overrides first, then
the graded "good" bands tightest-first:

  1. ``collapse`` : the terminal state (confidence < 25 OR WER > 0.7) wins over
     everything, including hallucination: a model that has given up is collapsed
     even if its broken output also scores as fabricated.
  2. ``hallucination`` : fluent fabrication (hallucination_score > 0.5).
  3. the nested healthy bands, checked tightest-first so ``stable_perception``
     is not swallowed by the looser ``semantic_drift`` condition.

Anything degraded that matches none of the bands falls back to ``semantic_drift``.
"""

from __future__ import annotations

from dataclasses import dataclass

import config

# stage_name → human-readable description / title.
_STAGE_LABELS: dict[str, str] = {
    "stable_perception": "Stable perception - transcript essentially correct",
    "perceptual_drift": "Perceptual drift - minor word errors, meaning intact",
    "semantic_drift": "Semantic drift - errors begin to change meaning",
    "hallucination": "Hallucination - confident but fabricated content",
    "collapse": "Perceptual collapse - output broken, empty, or repetitive",
}
_STAGE_TITLES: dict[str, str] = {
    "stable_perception": "Stable Perception",
    "perceptual_drift": "Perceptual Drift",
    "semantic_drift": "Semantic Drift",
    "hallucination": "Hallucination",
    "collapse": "Perceptual Collapse",
}


@dataclass
class FailureStage:
    """The failure stage classification for a single distortion level."""

    level: int
    stage_name: str  # stable_perception|perceptual_drift|semantic_drift|hallucination|collapse
    wer: float
    confidence: float
    hallucination_score: float
    label: str  # human-readable description


@dataclass
class FailureAnalysis:
    """Failure dynamics for one distortion type across its level sweep."""

    distortion_type: str
    failure_stages: list[FailureStage]  # one per level
    hallucination_threshold_level: int | None  # first hallucination level
    hallucination_threshold_intensity: float | None
    collapse_point_level: int | None  # first collapse level
    collapse_confidence: float | None
    confidence_collapse_rate: float  # how fast confidence fell
    most_dangerous_distortion: str | None  # set at experiment level
    overall_robustness: str  # "high" | "moderate" | "low" | "critical"
    peak_hallucination_score: float
    failure_path: list[str]  # human-readable stage labels


class FailureDynamicsAnalyzer:
    """Classify failure stages and summarize failure dynamics per distortion."""

    def analyze(self, metrics: dict) -> FailureAnalysis:
        """Analyze one distortion type's metrics block.

        Args:
            metrics: A per-distortion metrics block that includes a
                ``"distortion_type"`` key and a ``"levels"`` list (each level
                carrying ``wer``, ``confidence``, ``hallucination_score``,
                ``intensity``), ordered level 0 first.

        Returns:
            A :class:`FailureAnalysis`. ``most_dangerous_distortion`` is left
            ``None`` here and filled in at the experiment level.
        """
        distortion_type = metrics.get("distortion_type", "UNKNOWN")
        levels = metrics.get("levels", [])

        wer_curve = [float(l.get("wer", 0.0)) for l in levels]
        confidence_curve = [float(l.get("confidence", 0.0)) for l in levels]
        hallucination_curve = [float(l.get("hallucination_score", 0.0)) for l in levels]
        intensities = [l.get("intensity") for l in levels]

        stages = self.determine_failure_stages(
            wer_curve, confidence_curve, hallucination_curve
        )

        # Hallucination threshold = first level crossing HALLUCINATION_THRESHOLD.
        hall_level = next(
            (i for i, s in enumerate(hallucination_curve)
             if s >= config.HALLUCINATION_THRESHOLD),
            None,
        )
        hall_intensity = (
            intensities[hall_level]
            if hall_level is not None and hall_level < len(intensities)
            else None
        )

        # Collapse point = first level classified as the collapse stage.
        collapse_level = next(
            (s.level for s in stages if s.stage_name == "collapse"), None
        )
        collapse_confidence = (
            confidence_curve[collapse_level] if collapse_level is not None else None
        )

        rate = self._confidence_collapse_rate(confidence_curve)
        peak = max(hallucination_curve) if hallucination_curve else 0.0
        robustness = self.classify_robustness(hall_level, collapse_level, len(stages))

        return FailureAnalysis(
            distortion_type=distortion_type,
            failure_stages=stages,
            hallucination_threshold_level=hall_level,
            hallucination_threshold_intensity=(
                float(hall_intensity) if hall_intensity is not None else None
            ),
            collapse_point_level=collapse_level,
            collapse_confidence=collapse_confidence,
            confidence_collapse_rate=rate,
            most_dangerous_distortion=None,
            overall_robustness=robustness,
            peak_hallucination_score=peak,
            failure_path=self._build_failure_path(stages),
        )

    def determine_failure_stages(
        self,
        wer_curve: list[float],
        confidence_curve: list[float],
        hallucination_curve: list[float],
    ) -> list[FailureStage]:
        """Classify every level into a :class:`FailureStage`."""
        n = min(len(wer_curve), len(confidence_curve), len(hallucination_curve))
        stages: list[FailureStage] = []
        for i in range(n):
            wer = wer_curve[i]
            conf = confidence_curve[i]
            hall = hallucination_curve[i]
            stage_name = self._classify_stage(wer, conf, hall)
            stages.append(
                FailureStage(
                    level=i,
                    stage_name=stage_name,
                    wer=wer,
                    confidence=conf,
                    hallucination_score=hall,
                    label=_STAGE_LABELS[stage_name],
                )
            )
        return stages

    @staticmethod
    def _classify_stage(wer: float, confidence: float, hallucination: float) -> str:
        """Classify one level's stage (precedence per the module docstring)."""
        # Terminal overrides first: collapse beats hallucination.
        if confidence < 25 or wer > 0.7:
            return "collapse"
        if hallucination > 0.5:
            return "hallucination"
        # Healthy bands, tightest-first so they don't swallow each other.
        if wer < 0.05 and confidence > 85:
            return "stable_perception"
        if wer < 0.15 and confidence > 70:
            return "perceptual_drift"
        if wer < 0.40 and confidence > 45:
            return "semantic_drift"
        # Degraded but below the hallucination/collapse triggers.
        return "semantic_drift"

    def classify_robustness(
        self,
        hallucination_threshold_level: int | None,
        collapse_point: int | None,
        total_levels: int,
    ) -> str:
        """Grade robustness from where hallucination first appears.

        - No hallucination at all → ``"high"``.
        - First hallucination within the first 3 levels → ``"critical"``.
        - First hallucination only in the last 2 levels → ``"moderate"``.
        - Otherwise (middle levels) → ``"low"``.

        ``collapse_point`` is accepted for API completeness; the grade follows
        the hallucination-onset rules above.
        """
        if hallucination_threshold_level is None:
            return "high"
        if hallucination_threshold_level < 3:
            return "critical"
        if total_levels > 0 and hallucination_threshold_level >= total_levels - 2:
            return "moderate"
        return "low"

    @staticmethod
    def _confidence_collapse_rate(confidence_curve: list[float]) -> float:
        """Average confidence decline per level (positive == declining)."""
        if not confidence_curve:
            return 0.0
        return (confidence_curve[0] - confidence_curve[-1]) / len(confidence_curve)

    @staticmethod
    def _build_failure_path(stages: list[FailureStage]) -> list[str]:
        """Human-readable stage titles, collapsing consecutive duplicates."""
        path: list[str] = []
        for s in stages:
            title = _STAGE_TITLES[s.stage_name]
            if not path or path[-1] != title:
                path.append(title)
        return path
