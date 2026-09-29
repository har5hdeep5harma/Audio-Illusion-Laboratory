"""
distort.py : POST /api/distort

Runs the Distortion Engine for an uploaded experiment. For each selected
distortion type, generates EVERY intensity level from the canonical 16 kHz source
and writes one WAV per variant under ``uploads/<experiment_id>/variants/``:

    variants/<DISTORTION_TYPE>_level_<n>.wav   - one per (type, level)
    variants/manifest.json                      - index of all variants

The experiment's ``metadata.json`` status is advanced to ``"distorted"``.

Request:  { experiment_id, distortion_types?: ["WHITE_NOISE", ...] }  (empty = all)
Response: manifest summary (see api.schemas.DistortResponse).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import soundfile as sf
from fastapi import APIRouter, HTTPException, status

import config
import jobs
from api.schemas import DistortRequest, DistortResponse, VariantEntry
from api.security import experiment_path
from distortions import DistortionType, get_distortion
from distortions.base import DistortionLevel

logger = logging.getLogger("audio_illusion")
router = APIRouter()

CANONICAL_FILENAME = "original_16k.wav"
VARIANTS_DIRNAME = "variants"
MANIFEST_FILENAME = "manifest.json"
STATUS_DISTORTED = "distorted"


@router.post("/distort", summary="Queue the distortion sweep for an experiment.")
async def generate_distortions(payload: DistortRequest) -> dict:
    job = jobs.submit("distort", lambda: _run_distortions(payload))
    return jobs.as_dict(job)


def _run_distortions(payload: DistortRequest) -> DistortResponse:
    """Synthesize and persist every level of each selected distortion type."""
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

    # Empty selection == all distortion types.
    selected_types = payload.distortion_types or list(DistortionType)

    # Load the canonical mono 16 kHz signal as float32.
    audio, sr = sf.read(str(canonical_path), dtype="float32", always_2d=False)
    if sr != config.SAMPLE_RATE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Canonical audio sample rate {sr} != expected {config.SAMPLE_RATE}.",
        )

    variants_dir = experiment_dir / VARIANTS_DIRNAME
    variants_dir.mkdir(parents=True, exist_ok=True)

    variants: list[VariantEntry] = []
    try:
        for dtype in selected_types:
            distortion = get_distortion(dtype)
            for level in _requested_levels(distortion.get_levels(), payload.levels):
                rendered = distortion.apply(audio, sr, level.intensity)

                filename = f"{dtype.value}_level_{level.level_index}.wav"
                out_path = variants_dir / filename
                sf.write(str(out_path), rendered, sr, subtype="PCM_16")

                variants.append(
                    VariantEntry(
                        distortion_type=dtype,
                        level_index=level.level_index,
                        intensity=level.intensity,
                        label=level.label,
                        file_path=f"{VARIANTS_DIRNAME}/{filename}",
                    )
                )
    except Exception as exc:  # noqa: BLE001 - surface synthesis failures as 500
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Distortion synthesis failed: {exc}",
        ) from exc

    manifest_rel = f"{VARIANTS_DIRNAME}/{MANIFEST_FILENAME}"
    manifest = {
        "experiment_id": payload.experiment_id,
        "distortion_types": [t.value for t in selected_types],
        "total_variants": len(variants),
        "variants": [v.model_dump(mode="json") for v in variants],
    }
    _write_json(variants_dir / MANIFEST_FILENAME, manifest)

    _update_status(experiment_dir / "metadata.json", STATUS_DISTORTED)
    logger.info(
        "[%s] distortion complete: %d variant(s) across %d type(s)",
        payload.experiment_id,
        len(variants),
        len(selected_types),
    )

    return DistortResponse(
        experiment_id=payload.experiment_id,
        status=STATUS_DISTORTED,
        total_variants=len(variants),
        distortion_types=selected_types,
        variants=variants,
        manifest_path=manifest_rel,
    )


def _requested_levels(
    native_levels: list[DistortionLevel], requested: list[int] | None
) -> list[DistortionLevel]:
    """Resample a native ladder to the requested count while preserving endpoints."""
    if not requested:
        return native_levels
    if len(native_levels) < 2:
        return native_levels

    output: list[DistortionLevel] = []
    native_max = len(native_levels) - 1
    target_max = max(requested)
    for level_index in requested:
        position = (level_index / target_max) * native_max if target_max else 0.0
        lower = min(native_max, int(position))
        upper = min(native_max, lower + 1)
        fraction = position - lower
        lower_level = native_levels[lower]
        upper_level = native_levels[upper]
        intensity = lower_level.intensity + fraction * (
            upper_level.intensity - lower_level.intensity
        )
        label = (
            lower_level.label
            if lower == upper
            else f"{lower_level.label} -> {upper_level.label}"
        )
        output.append(
            DistortionLevel(
                level_index=level_index,
                intensity=float(intensity),
                label=label,
            )
        )
    return output


def _write_json(path: Path, data: dict) -> None:
    """Write ``data`` as pretty-printed JSON."""
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def _update_status(metadata_path: Path, new_status: str) -> None:
    """Advance the experiment's metadata status, if metadata exists."""
    if not metadata_path.is_file():
        return
    try:
        with metadata_path.open("r", encoding="utf-8") as fh:
            metadata = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return
    metadata["status"] = new_status
    _write_json(metadata_path, metadata)
