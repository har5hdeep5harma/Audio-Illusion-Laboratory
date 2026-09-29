"""
hallucination.py : Hallucination threshold detection & severity staging.

Consumes the per-level hallucination scores produced by
``SemanticAnalyzer.compute_hallucination_score`` and locates the Hallucination
Threshold (first level crossing 0.4), classifies each score into a severity
band, and builds a timeline mapping each level to its failure stage. The severity
bands map onto the five failure stages of context.md §2.
"""

from __future__ import annotations

import config

# Severity band → human-readable failure-stage label.
_STAGE_LABELS: dict[str, str] = {
    "none": "Stable Perception",
    "minor_drift": "Perceptual Drift",
    "semantic_drift": "Semantic Drift",
    "hallucination": "Hallucination",
    "collapse": "Perceptual Collapse",
}


class HallucinationDetector:
    """Detect hallucination onset and stage severity from score sequences."""

    def detect_threshold(
        self,
        hallucination_scores: list[float],
        threshold: float = config.HALLUCINATION_THRESHOLD,
    ) -> int | None:
        """Level index where the hallucination score first reaches ``threshold``.

        Returns ``None`` if the score never crosses the threshold.
        """
        for i, score in enumerate(hallucination_scores):
            if score >= threshold:
                return i
        return None

    @staticmethod
    def classify_severity(score: float) -> str:
        """Map a hallucination score to a severity band.

        Bands: ``none`` (<0.15), ``minor_drift`` (<0.30), ``semantic_drift``
        (<0.50), ``hallucination`` (<0.75), ``collapse`` (>=0.75).
        """
        if score < 0.15:
            return "none"
        if score < 0.30:
            return "minor_drift"
        if score < 0.50:
            return "semantic_drift"
        if score < 0.75:
            return "hallucination"
        return "collapse"

    def build_hallucination_timeline(self, scores: list[float]) -> list[dict]:
        """Build a per-level timeline of score, severity stage, and label."""
        timeline: list[dict] = []
        for level, score in enumerate(scores):
            stage = self.classify_severity(score)
            timeline.append(
                {
                    "level": level,
                    "score": float(score),
                    "stage": stage,
                    "label": _STAGE_LABELS[stage],
                }
            )
        return timeline
