"""
confidence.py : Confidence-curve analysis at the metrics layer.

Operates on the 0–100 Confidence Scores already attached to each transcript (see
``whisper.confidence``), turning an ordered sequence of per-level transcripts into
a confidence *curve* and summarizing its decline: the average drop per level and
the level at which confidence first falls below the collapse threshold.
"""

from __future__ import annotations

import config


class ConfidenceTracker:
    """Build and analyze the confidence curve across a distortion sweep."""

    def build_confidence_curve(self, transcript_results: list[dict]) -> list[float]:
        """Extract the 0–100 confidence from each transcript, in level order.

        Args:
            transcript_results: Ordered list of transcript dicts (level 0 first),
                each carrying a ``"confidence"`` field.

        Returns:
            The confidence value per level. Missing values default to 0.0.
        """
        return [float(r.get("confidence", 0.0)) for r in transcript_results]

    def compute_collapse_rate(self, curve: list[float]) -> float:
        """Average decline per level: ``(curve[0] - curve[-1]) / len(curve)``.

        Positive means confidence is declining (expected under distortion);
        returns 0.0 for an empty curve.
        """
        if not curve:
            return 0.0
        return (curve[0] - curve[-1]) / len(curve)

    def find_collapse_region(
        self, curve: list[float], threshold: float = config.COLLAPSE_CONFIDENCE_THRESHOLD
    ) -> int | None:
        """Index of the first level whose confidence drops below ``threshold``.

        Returns ``None`` if confidence never falls below the threshold.
        """
        for i, value in enumerate(curve):
            if value < threshold:
                return i
        return None
