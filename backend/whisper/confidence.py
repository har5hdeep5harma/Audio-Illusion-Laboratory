"""
confidence.py : Map Whisper segment log-probabilities to a 0–100 confidence.

Faster-Whisper reports a per-segment ``avg_logprob`` (typically -2.0 .. 0.0).
:class:`ConfidenceExtractor` converts these to a duration-weighted 0–100
Confidence Score using the linear map::

    confidence = clamp((1 + avg_logprob / 2) * 100, 0, 100)

  logprob  0.0 -> 100,  -0.5 -> 75,  -1.0 -> 50,  -2.0 -> 0

This is the model's *self-reported* certainty; it can stay deceptively high
during hallucination, which is exactly what the experiment probes. The same
extractor also flags the Perceptual Collapse condition (low confidence + high
WER).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Sequence

import config

if TYPE_CHECKING:  # avoid importing the engine (and its native deps) at runtime
    from whisper.engine import Segment


class ConfidenceExtractor:
    """Convert segment log-probabilities into a 0–100 confidence score."""

    @staticmethod
    def logprob_to_confidence(avg_logprob: float) -> float:
        """Map a single ``avg_logprob`` to a clamped 0–100 confidence."""
        return max(0.0, min(100.0, (1.0 + avg_logprob / 2.0) * 100.0))

    def extract_confidence(self, segments: "Sequence[Segment]") -> float:
        """Return the duration-weighted mean confidence across ``segments``.

        Each segment's confidence is weighted by its duration (``end - start``)
        so long, steady segments dominate over brief ones. Falls back to an
        unweighted mean if every segment has zero/negative duration, and returns
        ``0.0`` when there are no segments (e.g. no speech detected → collapse).
        """
        if not segments:
            return 0.0

        weighted_sum = 0.0
        total_weight = 0.0
        confidences: list[float] = []
        for seg in segments:
            conf = self.logprob_to_confidence(seg.avg_logprob)
            confidences.append(conf)
            weight = max(0.0, float(seg.end) - float(seg.start))
            weighted_sum += conf * weight
            total_weight += weight

        if total_weight > 0.0:
            return weighted_sum / total_weight
        # Degenerate timings — fall back to a simple mean.
        return sum(confidences) / len(confidences)

    @staticmethod
    def is_collapse(confidence: float, wer: float) -> bool:
        """True when the Perception Collapse condition is met.

        Collapse == confidence < COLLAPSE_CONFIDENCE_THRESHOLD (25) AND
        wer > COLLAPSE_WER_THRESHOLD (0.6). See context.md §5.
        """
        return (
            confidence < config.COLLAPSE_CONFIDENCE_THRESHOLD
            and wer > config.COLLAPSE_WER_THRESHOLD
        )
