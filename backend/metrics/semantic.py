"""
semantic.py : Sentence-embedding semantics: drift, preservation, hallucination.

Loads a local sentence-transformers model ("paraphrase-MiniLM-L6-v2" — small,
CPU-fast, strong paraphrase sensitivity; no paid APIs) exactly once and reuses it.
From sentence embeddings it derives:

  * Drift Index - cosine distance (1 - cosine similarity) between two texts.
  * Semantic Preservation - ``max(0, 1 - drift_index)``.
  * Hallucination Score - a WER-gated composite of drift and WER, encoding
    the intuition that high WER + high semantic drift = hallucination.

"""

from __future__ import annotations

import threading

import numpy as np

_MODEL_NAME = "paraphrase-MiniLM-L6-v2"


class SemanticAnalyzer:
    """Embedding-based semantic comparison (singleton; construct via get_analyzer)."""

    def __init__(self) -> None:
        # Imported lazily so importing this module stays cheap (torch + model
        # only load when the analyzer is actually constructed).
        from sentence_transformers import SentenceTransformer

        self.model_name = _MODEL_NAME
        self.model = SentenceTransformer(_MODEL_NAME)

    # embeddings
    def _embed(self, text: str) -> np.ndarray:
        """Encode a single text into a 1-D float embedding vector."""
        vec = self.model.encode([text or ""], convert_to_numpy=True)[0]
        return np.asarray(vec, dtype=np.float32)

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Cosine similarity in [-1, 1]; 0.0 if either vector is degenerate."""
        na = float(np.linalg.norm(a))
        nb = float(np.linalg.norm(b))
        if na == 0.0 or nb == 0.0:
            return 0.0
        return float(np.dot(a, b) / (na * nb))

    # metrics
    def compute_drift_index(self, text_a: str, text_b: str) -> float:
        """Cosine distance (1 - cosine similarity) between two texts.

        Range 0.0 (identical meaning) .. 2.0 (opposite); practical range 0.0–1.0.
        """
        sim = self._cosine_similarity(self._embed(text_a), self._embed(text_b))
        return 1.0 - sim

    def compute_semantic_preservation(self, text_a: str, text_b: str) -> float:
        """``max(0, 1 - drift_index)`` — 1.0 = perfectly preserved meaning."""
        return max(0.0, 1.0 - self.compute_drift_index(text_a, text_b))

    def compute_hallucination_score(
        self, reference: str, hypothesis: str, wer: float
    ) -> float:
        """WER-gated composite of semantic drift and WER.

        Range 0.0 (no hallucination) .. 1.0 (complete hallucination). Low WER
        contributes only mild drift; as WER rises, drift and WER jointly drive
        the score, with a floor bump once WER is high.
        """
        drift = self.compute_drift_index(reference, hypothesis)

        if wer < 0.1:
            return drift * 0.3
        if wer < 0.4:
            return drift * 0.6 + wer * 0.4
        return min(1.0, drift * 0.5 + wer * 0.5 + 0.1)


# module-level singleton
_analyzer: SemanticAnalyzer | None = None
_analyzer_lock = threading.Lock()


def get_analyzer() -> SemanticAnalyzer:
    """Return the shared :class:`SemanticAnalyzer`, loading the model once.

    Thread-safe (double-checked locking).
    """
    global _analyzer
    if _analyzer is None:
        with _analyzer_lock:
            if _analyzer is None:
                _analyzer = SemanticAnalyzer()
    return _analyzer
