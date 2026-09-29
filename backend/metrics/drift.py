"""
drift.py : Drift Index & Semantic Preservation.

Drift Index = cosine distance between sentence embeddings of the reference vs the
transcript (0–1). Semantic Preservation Score = 1 - Drift Index. Uses embeddings
from ``metrics.semantic``. See context.md §5.
"""

from __future__ import annotations

# def drift_index(reference: str, hypothesis: str) -> float:
#     """Cosine distance between reference and hypothesis embeddings (0–1)."""
#     raise NotImplementedError
#
# def semantic_preservation(reference: str, hypothesis: str) -> float:
#     """1 - drift_index(reference, hypothesis)."""
#     raise NotImplementedError
