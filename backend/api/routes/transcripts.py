"""
transcripts.py : Whisper transcription endpoints.

POST /api/transcribe
    Triggered operation: transcribes the clean original plus (optionally) every
    distortion variant listed in the experiment's manifest, writing one JSON per
    audio file under ``uploads/<experiment_id>/transcripts/`` and advancing the
    experiment status to ``"transcribed"``.

        transcripts/original_transcript.json
        transcripts/<DISTORTION_TYPE>_level_<n>_transcript.json

GET /api/transcript/{experiment_id}
    Returns all previously-computed transcripts for the experiment as structured
    JSON ({ experiment_id, original, variants: [...] }).

The :class:`WhisperEngine` singleton is injected via FastAPI dependency injection
(``Depends(get_engine)``); it is warmed up once at app startup.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status

import config
import jobs
from api.dependencies import get_whisper_engine
from api.schemas import TranscribeRequest, TranscribeResponse
from api.security import experiment_path
from whisper.confidence import ConfidenceExtractor
from whisper.engine import (
    TranscriptionResult,
    WhisperEngine,
    WhisperTranscriptionError,
)

logger = logging.getLogger("audio_illusion")
router = APIRouter()

CANONICAL_FILENAME = "original_16k.wav"
TRANSCRIPTS_DIRNAME = "transcripts"
VARIANTS_DIRNAME = "variants"
MANIFEST_FILENAME = "manifest.json"
ORIGINAL_TRANSCRIPT_FILENAME = "original_transcript.json"
STATUS_TRANSCRIBED = "transcribed"

_confidence = ConfidenceExtractor()


@router.post("/transcribe", summary="Queue transcription for an experiment.")
async def transcribe_experiment(
    payload: TranscribeRequest,
    engine: WhisperEngine = Depends(get_whisper_engine),
) -> dict:
    job = jobs.submit(
        "transcribe", lambda: _run_transcription(payload, engine)
    )
    return jobs.as_dict(job)


def _run_transcription(
    payload: TranscribeRequest, engine: WhisperEngine
) -> TranscribeResponse:
    """Run Whisper over the clean original and (optionally) every variant."""
    logger.info("[%s] transcription started", payload.experiment_id)
    experiment_dir = experiment_path(payload.experiment_id)
    canonical_path = experiment_dir / CANONICAL_FILENAME

    if not experiment_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment '{payload.experiment_id}' not found.",
        )
    if not canonical_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Canonical audio (original_16k.wav) is missing for this experiment.",
        )

    transcripts_dir = experiment_dir / TRANSCRIPTS_DIRNAME
    transcripts_dir.mkdir(parents=True, exist_ok=True)

    # 1. Always transcribe the clean original (the reference baseline).
    original = _safe_transcribe(engine, str(canonical_path))
    _write_json(
        transcripts_dir / ORIGINAL_TRANSCRIPT_FILENAME,
        _serialize(original, distortion_type="ORIGINAL", level_index=0,
                   intensity=0.0, label="Clean original"),
    )

    # 2. Transcribe each variant from the manifest, if requested.
    total_variants = 0
    if payload.run_all_variants:
        variants = _load_manifest_variants(experiment_dir)
        for entry in variants:
            variant_path = experiment_dir / entry["file_path"]
            if not variant_path.is_file():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Variant audio missing: {entry['file_path']}",
                )
            result = _safe_transcribe(engine, str(variant_path))
            out_name = (
                f"{entry['distortion_type']}_level_{entry['level_index']}"
                "_transcript.json"
            )
            _write_json(
                transcripts_dir / out_name,
                _serialize(
                    result,
                    distortion_type=entry["distortion_type"],
                    level_index=entry["level_index"],
                    intensity=entry.get("intensity"),
                    label=entry.get("label", ""),
                ),
            )
            total_variants += 1

    _update_status(experiment_dir / "metadata.json", STATUS_TRANSCRIBED)
    logger.info(
        "[%s] transcription complete: %d variant(s) + original",
        payload.experiment_id,
        total_variants,
    )

    return TranscribeResponse(
        experiment_id=payload.experiment_id,
        total_variants=total_variants,
        status=STATUS_TRANSCRIBED,
    )


@router.get(
    "/transcript/{experiment_id}",
    summary="Fetch all stored transcripts for an experiment.",
)
async def get_transcripts(experiment_id: str) -> dict:
    """Return the original + all variant transcripts as structured JSON."""
    transcripts_dir = experiment_path(experiment_id) / TRANSCRIPTS_DIRNAME
    if not transcripts_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No transcripts found for experiment '{experiment_id}'. "
                "Run POST /api/transcribe first."
            ),
        )

    original: dict | None = None
    variants: list[dict] = []
    for path in sorted(transcripts_dir.glob("*_transcript.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Corrupted transcript file '{path.name}': {exc}",
            ) from exc
        if path.name == ORIGINAL_TRANSCRIPT_FILENAME:
            original = data
        else:
            variants.append(data)

    variants.sort(key=lambda d: (d.get("distortion_type", ""), d.get("level_index", 0)))

    return {
        "experiment_id": experiment_id,
        "original": original,
        "variants": variants,
    }


# helpers 
def _safe_transcribe(engine: WhisperEngine, audio_path: str) -> TranscriptionResult:
    """Transcribe, converting backend failures into an informative HTTP 500."""
    try:
        return engine.transcribe(audio_path)
    except WhisperTranscriptionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


def _serialize(
    result: TranscriptionResult,
    *,
    distortion_type: str,
    level_index: int,
    intensity: float | None,
    label: str,
) -> dict:
    """Convert a result (+ provenance) into a JSON-serializable dict.

    Adds the computed 0–100 Confidence Score alongside the raw log-prob mean.
    """
    payload = asdict(result)
    payload["confidence"] = _confidence.extract_confidence(result.segments)
    payload["distortion_type"] = distortion_type
    payload["level_index"] = level_index
    payload["intensity"] = intensity
    payload["label"] = label
    return payload


def _load_manifest_variants(experiment_dir: Path) -> list[dict]:
    """Read the variant manifest; 404 if the experiment was never distorted."""
    manifest_path = experiment_dir / VARIANTS_DIRNAME / MANIFEST_FILENAME
    if not manifest_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No variant manifest found. Run POST /api/distort before "
                "transcribing variants."
            ),
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Corrupted manifest.json: {exc}",
        ) from exc
    return manifest.get("variants", [])


def _write_json(path: Path, data: dict) -> None:
    """Write ``data`` as pretty-printed JSON."""
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def _update_status(metadata_path: Path, new_status: str) -> None:
    """Advance the experiment's metadata status, if metadata exists."""
    if not metadata_path.is_file():
        return
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    metadata["status"] = new_status
    _write_json(metadata_path, metadata)
