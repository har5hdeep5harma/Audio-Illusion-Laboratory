from __future__ import annotations

import os
import tempfile
from pathlib import Path

BASE_DIR: Path = Path(__file__).resolve().parent
TEMP_DIR: Path = Path(
    os.getenv("TEMP_DIR", Path(tempfile.gettempdir()) / "audio-illusion-laboratory")
)
UPLOAD_DIR: Path = TEMP_DIR
CACHE_DIR: Path = TEMP_DIR / "cache"
EXPORT_DIR: Path = TEMP_DIR / "exports"

SAMPLE_RATE: int = 16000               # canonical mono sample rate (Hz)
MAX_AUDIO_DURATION: int = 120          # max accepted clip length (seconds)
MAX_UPLOAD_BYTES: int = int(os.getenv("MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
SUPPORTED_FORMATS: tuple[str, ...] = (".wav", ".mp3", ".flac", ".ogg", ".m4a")

# Temporary experiment retention. Reports are exported in the browser; 
# The server removes intermediate files after this window.
TEMP_RETENTION_SECONDS: int = int(os.getenv("TEMP_RETENTION_SECONDS", 900))
JOB_WORKERS: int = int(os.getenv("JOB_WORKERS", 1))

# Distortion sweep 
# Level 0 is always the clean baseline (identity transform). Higher = harsher.
DISTORTION_LEVELS: list[int] = [0, 1, 2, 3, 4, 5]
DISTORTION_TYPES: tuple[str, ...] = (
    "noise",
    "echo",
    "compression",
    "pitch",
    "speed",
    "combined",
)

# Whisper (Faster-Whisper, CPU-only, NO GPU) 
WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE: str = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE: str = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

# Embeddings (local sentence-transformers)
EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

# Scientific thresholds
HALLUCINATION_THRESHOLD: float = 0.4   # hallucination score crossing point
COLLAPSE_WER_THRESHOLD: float = 0.6    # WER above this contributes to collapse
COLLAPSE_CONFIDENCE_THRESHOLD: float = 25.0  # confidence below this -> collapse

# API
API_PREFIX: str = "/api"
CORS_ORIGINS: list[str] = os.getenv(
    "CORS_ORIGINS", "http://localhost:3000"
).split(",")
