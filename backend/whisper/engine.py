"""
engine.py : Faster-Whisper transcription engine (CPU-only).

Wraps ``faster_whisper.WhisperModel`` in a process-wide singleton
(:class:`WhisperEngine`) loaded once with ``device="cpu", compute_type="int8"``
(model "base" by default) and reused for every inference. Loading the model is
expensive, so :func:`get_engine` is called from the FastAPI startup hook to pay
that cost up front, and injected into routes via FastAPI dependency injection.

Never loads on GPU — this project is strictly CPU-only (context.md §12).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

import config


class WhisperTranscriptionError(Exception):
    """Raised when Faster-Whisper fails to transcribe an audio file."""


@dataclass
class Word:
    """A single word with timing and the model's per-word probability."""

    word: str
    start: float
    end: float
    probability: float


@dataclass
class Segment:
    """One Whisper segment plus the raw fields used for confidence scoring."""

    text: str
    start: float
    end: float
    avg_logprob: float  # raw from faster-whisper (typically -2.0 .. 0.0)
    no_speech_prob: float
    words: list[Word] = field(default_factory=list)


@dataclass
class TranscriptionResult:
    """Full transcription of one audio file."""

    transcript: str  # full joined text
    segments: list[Segment]
    language: str
    duration: float
    raw_confidence: float  # mean of segment avg_logprob


class WhisperEngine:
    """Singleton wrapper around a CPU Faster-Whisper model.

    Construct via :func:`get_engine`; do not instantiate directly elsewhere so
    the model is loaded at most once per process.
    """

    def __init__(self) -> None:
        # Imported here so merely importing this module stays cheap (the heavy
        # native deps only load when the engine is actually constructed).
        from faster_whisper import WhisperModel

        self.model_size = config.WHISPER_MODEL
        self.model = WhisperModel(
            config.WHISPER_MODEL,
            device=config.WHISPER_DEVICE,
            compute_type=config.WHISPER_COMPUTE_TYPE,
        )

    def transcribe(
        self,
        audio_path: str,
        *,
        language: str = "en",
        word_timestamps: bool = True,
    ) -> TranscriptionResult:
        """Transcribe an audio file and return a structured result.

        Args:
            audio_path: Path to a 16 kHz mono WAV (canonical or a variant).
            language: Forced decode language (default English).
            word_timestamps: Emit per-word timings when True.

        Returns:
            A :class:`TranscriptionResult`.

        Raises:
            WhisperTranscriptionError: If decoding/inference fails for any reason.
        """
        try:
            segment_iter, info = self.model.transcribe(
                audio_path,
                language=language,
                word_timestamps=word_timestamps,
            )

            segments: list[Segment] = []
            text_parts: list[str] = []
            for seg in segment_iter:
                words: list[Word] = []
                for w in getattr(seg, "words", None) or []:
                    words.append(
                        Word(
                            word=w.word,
                            start=float(w.start),
                            end=float(w.end),
                            probability=float(w.probability),
                        )
                    )
                segments.append(
                    Segment(
                        text=seg.text,
                        start=float(seg.start),
                        end=float(seg.end),
                        avg_logprob=float(seg.avg_logprob),
                        no_speech_prob=float(seg.no_speech_prob),
                        words=words,
                    )
                )
                text_parts.append(seg.text)
        except Exception as exc:  # noqa: BLE001 — normalize any backend failure
            raise WhisperTranscriptionError(
                f"Failed to transcribe '{audio_path}': {exc}"
            ) from exc

        # raw_confidence = mean of segment avg_logprob. With no detected speech
        # there is nothing to average; use a clearly-low logprob sentinel so the
        # value never masquerades as high confidence.
        if segments:
            raw_confidence = sum(s.avg_logprob for s in segments) / len(segments)
        else:
            raw_confidence = -10.0

        return TranscriptionResult(
            transcript="".join(text_parts).strip(),
            segments=segments,
            language=getattr(info, "language", language) or language,
            duration=float(getattr(info, "duration", 0.0) or 0.0),
            raw_confidence=float(raw_confidence),
        )


# module-level singleton
_engine: WhisperEngine | None = None
_engine_lock = threading.Lock()


def get_engine() -> WhisperEngine:
    """Return the shared :class:`WhisperEngine`, loading the model on first use.

    Thread-safe (double-checked locking): the model is loaded at most once per
    process. Suitable as a FastAPI dependency (``Depends(get_engine)``).
    """
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = WhisperEngine()
    return _engine


def warmup() -> None:
    """Eagerly construct the singleton (used by the FastAPI startup hook)."""
    get_engine()
