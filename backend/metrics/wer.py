"""
wer.py : Word Error Rate.

Computes WER = (substitutions + deletions + insertions) / reference_words between
a reference and a hypothesis transcript via the ``jiwer`` library. Both strings
are normalized first (lowercase, punctuation stripped, whitespace collapsed) so
scoring reflects word-level errors rather than formatting. WER can exceed 1.0
when the hypothesis inserts many spurious words, a hallmark of hallucination.
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass

import jiwer

_PUNCT_TABLE = str.maketrans("", "", string.punctuation)


@dataclass
class WERResult:
    """Word Error Rate plus the aligned edit-operation breakdown."""

    wer: float  # 0.0 .. 1.0+ (can exceed 1.0 with many insertions)
    insertions: int
    deletions: int
    substitutions: int
    reference_length: int
    hypothesis_length: int


class WERCalculator:
    """Compute WER and edit counts between a reference and hypothesis."""

    def calculate(self, reference: str, hypothesis: str) -> WERResult:
        """Return a :class:`WERResult` for ``hypothesis`` vs ``reference``.

        Both inputs are normalized before alignment. An empty reference yields a
        zeroed result (no words to err against); an empty hypothesis against a
        non-empty reference yields all-deletions (WER 1.0).
        """
        ref = self._normalize(reference)
        hyp = self._normalize(hypothesis)

        ref_len = len(ref.split())
        hyp_len = len(hyp.split())

        # Empty reference: nothing to measure error against.
        if ref_len == 0:
            return WERResult(
                wer=0.0,
                insertions=0,
                deletions=0,
                substitutions=0,
                reference_length=0,
                hypothesis_length=hyp_len,
            )

        # Empty hypothesis vs non-empty reference: every reference word deleted.
        if hyp_len == 0:
            return WERResult(
                wer=1.0,
                insertions=0,
                deletions=ref_len,
                substitutions=0,
                reference_length=ref_len,
                hypothesis_length=0,
            )

        out = jiwer.process_words(ref, hyp)
        return WERResult(
            wer=float(out.wer),
            insertions=int(out.insertions),
            deletions=int(out.deletions),
            substitutions=int(out.substitutions),
            reference_length=ref_len,
            hypothesis_length=hyp_len,
        )

    @staticmethod
    def _normalize(text: str) -> str:
        """Lowercase, strip punctuation, and collapse whitespace."""
        if not text:
            return ""
        text = text.lower().translate(_PUNCT_TABLE)
        return re.sub(r"\s+", " ", text).strip()
