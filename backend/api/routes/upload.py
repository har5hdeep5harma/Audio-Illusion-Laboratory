"""
upload.py : POST /api/upload

Accepts an uploaded audio file (multipart/form-data), assigns a UUID4 experiment
id, validates the file (format + duration via ``audio.validator``), resamples it
to the canonical 16 kHz mono source (``audio.resampler``), and stores everything
under ``uploads/<experiment_id>/``:

    original.<ext>     - the raw upload, untouched
    original_16k.wav   - canonical mono 16 kHz signal the pipeline consumes
    metadata.json      - experiment metadata

"""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import soundfile as sf
from fastapi import APIRouter, File, HTTPException, UploadFile, status

import config
from api.schemas import UploadResponse
from audio.loader import AudioLoader, AudioLoadError
from audio.resampler import AudioResampler
from audio.validator import AudioValidator

logger = logging.getLogger("audio_illusion")
router = APIRouter()

_loader = AudioLoader()
_validator = AudioValidator()
_resampler = AudioResampler()

STATUS_UPLOADED = "uploaded"


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an audio file and create an experiment.",
)
async def upload_audio(file: UploadFile = File(...)) -> UploadResponse:
    """Validate, resample, and persist an uploaded audio file.

    Creates a new experiment keyed by a UUID4, stores the raw upload and the
    canonical 16 kHz mono WAV, writes ``metadata.json``, and returns the
    experiment summary.
    """
    original_filename = file.filename or "upload"
    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in config.SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported file format '{ext or '(none)'}'. Supported formats: "
                f"{', '.join(config.SUPPORTED_FORMATS)}."
            ),
        )

    experiment_id = str(uuid4())
    experiment_dir = Path(config.UPLOAD_DIR) / experiment_id
    experiment_dir.mkdir(parents=True, exist_ok=True)

    original_path = experiment_dir / f"original{ext}"

    try:
        # 1. Persist the raw upload to disk (streamed copy).
        file_size_bytes = await _save_upload(file, original_path)

        # 2. Validate format / emptiness / integrity / duration.
        result = _validator.validate(str(original_path), file_size_bytes)
        if not result.is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=result.error
            )

        # 3. Decode and resample to the canonical mono 16 kHz signal.
        try:
            audio, original_sr = _loader.load(str(original_path))
            canonical = _resampler.resample(
                audio, original_sr, config.SAMPLE_RATE
            )
        except AudioLoadError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Could not decode audio: {exc}",
            ) from exc

        # 4. Write the canonical WAV.
        canonical_path = experiment_dir / "original_16k.wav"
        sf.write(str(canonical_path), canonical, config.SAMPLE_RATE, subtype="PCM_16")

        # Recompute duration from the canonical signal for exactness.
        duration_seconds = round(len(canonical) / config.SAMPLE_RATE, 3)

        # 5. Persist metadata.
        created_at = datetime.now(timezone.utc).isoformat()
        metadata = {
            "experiment_id": experiment_id,
            "original_filename": original_filename,
            "duration_seconds": duration_seconds,
            "sample_rate": config.SAMPLE_RATE,
            "created_at": created_at,
            "status": STATUS_UPLOADED,
        }
        _write_metadata(experiment_dir / "metadata.json", metadata)
        logger.info(
            "[%s] uploaded '%s' (%.1fs)",
            experiment_id,
            original_filename,
            duration_seconds,
        )

    except HTTPException:
        # Validation/decoding failure: clean up the partial experiment dir.
        shutil.rmtree(experiment_dir, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001 - convert unexpected errors to 500 + cleanup
        shutil.rmtree(experiment_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process upload: {exc}",
        ) from exc
    finally:
        await file.close()

    return UploadResponse(
        experiment_id=experiment_id,
        filename=original_filename,
        duration_seconds=duration_seconds,
        sample_rate=config.SAMPLE_RATE,
        status=STATUS_UPLOADED,
    )


async def _save_upload(file: UploadFile, dest: Path) -> int:
    """Stream an ``UploadFile`` to ``dest`` in chunks; return bytes written."""
    chunk_size = 1024 * 1024  # 1 MiB
    total = 0
    with dest.open("wb") as out:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            if total + len(chunk) > config.MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=(
                        f"Upload exceeds the {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit."
                    ),
                )
            out.write(chunk)
            total += len(chunk)
    return total


def _write_metadata(path: Path, metadata: dict) -> None:
    """Write experiment metadata as pretty-printed JSON."""
    with path.open("w", encoding="utf-8") as fh:
        json.dump(metadata, fh, indent=2)
