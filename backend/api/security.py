"""Request validation and disposable experiment storage helpers."""

from __future__ import annotations

import shutil
import threading
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, status

import config


def validated_experiment_id(value: str) -> str:
    """Accept only UUID4 identifiers before using them in a filesystem path."""
    try:
        parsed = UUID(value, version=4)
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="experiment_id must be a valid UUID4.",
        ) from exc
    if str(parsed) != value.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="experiment_id must be a canonical UUID4.",
        )
    return str(parsed)


def experiment_path(experiment_id: str) -> Path:
    """Return the validated temporary directory for an experiment."""
    return config.UPLOAD_DIR / validated_experiment_id(experiment_id)


def remove_experiment(experiment_id: str) -> None:
    """Delete all temporary audio, intermediate, and report artifacts."""
    shutil.rmtree(experiment_path(experiment_id), ignore_errors=True)


def schedule_cleanup(experiment_id: str) -> None:
    """Remove temporary state after the browser has had time to export it."""
    timer = threading.Timer(
        config.TEMP_RETENTION_SECONDS, remove_experiment, args=(experiment_id,)
    )
    timer.daemon = True
    timer.start()
