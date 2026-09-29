"""
loader.py : Decode audio files into numpy float32 waveforms.

Wraps librosa (which dispatches to soundfile for wav/flac/ogg and to
audioread/ffmpeg for mp3/m4a) to read any supported file into a float32 array
plus its native sample rate. Channels are preserved here; mono down-mixing is the
resampler's responsibility so the loader stays a thin, format-aware decoder.
"""

from __future__ import annotations

import os

import librosa
import numpy as np

import config


class AudioLoadError(Exception):
    """Raised when an audio file cannot be loaded (unsupported or corrupted)."""


class AudioLoader:
    """Decode audio files into float32 waveforms at their native sample rate."""

    #: Extensions this loader will attempt to decode.
    SUPPORTED_FORMATS: tuple[str, ...] = config.SUPPORTED_FORMATS

    def load(self, file_path: str) -> tuple[np.ndarray, int]:
        """Load an audio file into a float32 array and its native sample rate.

        Channels are preserved: mono returns shape ``(n_samples,)`` and stereo/
        multichannel returns ``(n_channels, n_samples)`` (librosa convention).

        Args:
            file_path: Path to a ``wav``, ``mp3``, ``m4a``, or ``flac`` file.

        Returns:
            ``(audio_array, sample_rate)`` where ``audio_array`` is float32.

        Raises:
            AudioLoadError: If the format is unsupported, the file is missing,
                or the audio cannot be decoded.
        """
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in self.SUPPORTED_FORMATS:
            raise AudioLoadError(
                f"Unsupported audio format '{ext}'. "
                f"Supported formats: {', '.join(self.SUPPORTED_FORMATS)}"
            )
        if not os.path.isfile(file_path):
            raise AudioLoadError(f"Audio file not found: {file_path}")

        try:
            # sr=None preserves the native rate; mono=False preserves channels.
            audio, sample_rate = librosa.load(file_path, sr=None, mono=False)
        except Exception as exc:  # noqa: BLE001 - surface any decode failure uniformly
            raise AudioLoadError(
                f"Failed to decode audio file '{file_path}': {exc}"
            ) from exc

        if audio is None or audio.size == 0:
            raise AudioLoadError(f"Audio file contains no samples: {file_path}")

        return np.asarray(audio, dtype=np.float32), int(sample_rate)
