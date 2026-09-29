"""
dependencies.py : FastAPI dependency providers for the shared singletons.

The Whisper engine and the sentence-transformers analyzer are both expensive to
construct, so each is a process-wide singleton built at most once (lazily, with
double-checked locking, see whisper.engine / metrics.semantic). These thin
wrappers expose them as FastAPI dependencies; ``warmup_models`` is called from
the app's startup hook so the models are loaded once at boot rather than on the
first request.
"""

from __future__ import annotations

import logging

from metrics.semantic import SemanticAnalyzer, get_analyzer
from whisper.engine import WhisperEngine, get_engine

logger = logging.getLogger("audio_illusion")


def get_whisper_engine() -> WhisperEngine:
    """FastAPI dependency: the shared CPU Whisper engine (loaded once)."""
    return get_engine()


def get_semantic_analyzer() -> SemanticAnalyzer:
    """FastAPI dependency: the shared sentence-transformers analyzer (loaded once)."""
    return get_analyzer()


def warmup_models() -> None:
    """Eagerly construct both singletons at startup (best-effort, logged).

    A failure to load either model (e.g. no cached weights, offline first run)
    is logged but never fatal, the model will load lazily on first use.
    """
    try:
        get_whisper_engine()
        logger.info("Whisper engine warmed up.")
    except Exception as exc:  # noqa: BLE001 - warmup must never crash startup
        logger.warning("Whisper warmup skipped (loads on first use): %s", exc)

    try:
        get_semantic_analyzer()
        logger.info("Semantic analyzer warmed up.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Semantic analyzer warmup skipped (loads on first use): %s", exc)
