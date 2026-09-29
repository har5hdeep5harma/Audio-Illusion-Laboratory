"""
validator.py : Validate uploaded audio before processing.

Checks file extension against SUPPORTED_FORMATS, ensures the file is non-empty
and decodable, and enforces MAX_AUDIO_DURATION. Validation never raises for an
invalid file: it returns a structured ``ValidationResult`` so the upload route
can map failures to HTTP 400 with a clear message.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import librosa

import config


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of validating an uploaded audio file.

    Attributes:
        is_valid: True only if every check passed.
        error: Human-readable reason for failure, else ``None``.
        duration_seconds: Decoded duration in seconds when measurable, else
            ``None`` (e.g. when the file could not be decoded).
    """

    is_valid: bool
    error: str | None = None
    duration_seconds: float | None = None


class AudioValidator:
    """Validate audio uploads for format, emptiness, integrity, and duration."""

    #: Extensions accepted for upload.
    SUPPORTED_FORMATS: tuple[str, ...] = config.SUPPORTED_FORMATS
    #: Maximum accepted clip length, in seconds.
    MAX_AUDIO_DURATION: int = config.MAX_AUDIO_DURATION

    def validate(self, file_path: str, file_size_bytes: int) -> ValidationResult:
        """Validate an uploaded audio file.

        Args:
            file_path: Path to the saved upload.
            file_size_bytes: Size of the uploaded file in bytes.

        Returns:
            A ``ValidationResult`` describing whether the file is acceptable.
        """
        # 1. Extension must be supported.
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in self.SUPPORTED_FORMATS:
            return ValidationResult(
                is_valid=False,
                error=(
                    f"Unsupported file format '{ext}'. Supported formats: "
                    f"{', '.join(self.SUPPORTED_FORMATS)}."
                ),
            )

        # 2. File must not be empty.
        if file_size_bytes <= 0:
            return ValidationResult(
                is_valid=False, error="Uploaded file is empty."
            )
        if not os.path.isfile(file_path) or os.path.getsize(file_path) == 0:
            return ValidationResult(
                is_valid=False, error="Uploaded file is empty or missing on disk."
            )

        # 3. File must be decodable (not corrupted) and have measurable duration.
        try:
            duration_seconds = float(librosa.get_duration(path=file_path))
        except Exception as exc:  # noqa: BLE001 - any decode error means corrupt/unreadable
            return ValidationResult(
                is_valid=False,
                error=f"Audio file is corrupted or could not be decoded: {exc}",
            )

        if duration_seconds <= 0:
            return ValidationResult(
                is_valid=False,
                error="Audio file has zero duration.",
                duration_seconds=duration_seconds,
            )

        # 4. Duration must be within the configured cap.
        if duration_seconds > self.MAX_AUDIO_DURATION:
            return ValidationResult(
                is_valid=False,
                error=(
                    f"Audio duration {duration_seconds:.2f}s exceeds the maximum "
                    f"of {self.MAX_AUDIO_DURATION}s."
                ),
                duration_seconds=duration_seconds,
            )

        return ValidationResult(
            is_valid=True, error=None, duration_seconds=duration_seconds
        )
