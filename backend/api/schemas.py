"""
schemas.py : Pydantic v2 request/response models for the API layer.

Centralizes the wire shapes exchanged with the frontend so routes stay thin and
the contract is enforced in one place.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from distortions import DistortionType


class UploadResponse(BaseModel):
    """Response body for ``POST /api/upload``."""

    model_config = ConfigDict(extra="forbid")

    experiment_id: str = Field(..., description="UUID4 identifying the experiment.")
    filename: str = Field(..., description="Original uploaded filename.")
    duration_seconds: float = Field(
        ..., ge=0.0, description="Duration of the canonical 16 kHz audio, seconds."
    )
    sample_rate: int = Field(
        ..., gt=0, description="Sample rate of the canonical audio (16000)."
    )
    status: str = Field("uploaded", description="Experiment lifecycle status.")


class HealthResponse(BaseModel):
    """Response body for ``GET /health``."""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(..., description="Liveness status, e.g. 'ok'.")
    model: str = Field(..., description="ASR backend identifier.")


class ErrorResponse(BaseModel):
    """Structured error envelope returned by the exception handlers."""

    model_config = ConfigDict(extra="forbid")

    error: str = Field(..., description="Short error category / type.")
    detail: str = Field(..., description="Human-readable error description.")


# Distortion endpoint
class DistortRequest(BaseModel):
    """Request body for ``POST /api/distort``."""

    model_config = ConfigDict(extra="forbid")

    experiment_id: str = Field(..., description="UUID4 of an uploaded experiment.")
    distortion_types: list[DistortionType] = Field(
        default_factory=list,
        description=(
            "Distortion types to generate. Empty means all available types. "
            "Every level of each selected type is generated."
        ),
    )
    levels: list[int] | None = Field(
        default=None,
        description="Requested zero-based output levels; omitted uses each native ladder.",
    )


class VariantEntry(BaseModel):
    """One generated distortion variant in the manifest."""

    model_config = ConfigDict(extra="forbid")

    distortion_type: DistortionType
    level_index: int = Field(..., ge=0)
    intensity: float
    label: str
    file_path: str = Field(
        ..., description="Path to the variant WAV, relative to the experiment dir."
    )


class DistortResponse(BaseModel):
    """Response body for ``POST /api/distort`` (manifest summary)."""

    model_config = ConfigDict(extra="forbid")

    experiment_id: str
    status: str = Field("distorted", description="Experiment lifecycle status.")
    total_variants: int = Field(..., ge=0)
    distortion_types: list[DistortionType]
    variants: list[VariantEntry]
    manifest_path: str = Field(
        ..., description="Path to manifest.json, relative to the experiment dir."
    )


# Transcription endpoint 
class TranscribeRequest(BaseModel):
    """Request body for ``POST /api/transcribe``."""

    model_config = ConfigDict(extra="forbid")

    experiment_id: str = Field(..., description="UUID4 of a distorted experiment.")
    run_all_variants: bool = Field(
        True,
        description=(
            "When True, transcribe every distortion variant in addition to the "
            "clean original. When False, only the original is transcribed."
        ),
    )


class TranscribeResponse(BaseModel):
    """Response body for ``POST /api/transcribe``."""

    model_config = ConfigDict(extra="forbid")

    experiment_id: str
    total_variants: int = Field(..., ge=0, description="Variant transcripts written.")
    status: str = Field("transcribed", description="Experiment lifecycle status.")


# Metrics endpoint
class MetricsRequest(BaseModel):
    """Request body for ``POST /api/metrics``."""

    model_config = ConfigDict(extra="forbid")

    experiment_id: str = Field(..., description="UUID4 of a transcribed experiment.")


# Numpy-safe JSON serialization
def to_jsonable(obj: Any) -> Any:
    """Recursively convert a value into JSON-safe Python natives.

    FastAPI/`json` cannot serialize numpy scalars/arrays or Python ``set``s, and
    chokes on non-finite floats. This normalizes all of them:
      * numpy integers/floats/bools → int/float/bool
      * numpy arrays → lists
      * sets/tuples → lists
      * NaN / ±Inf → None
    Apply it to any response dict assembled from computed (numpy-adjacent) values.
    """
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [to_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    return obj


# Response models mirroring the analysis / metrics dataclasses
# These document the JSON shapes and are exported for serialization/validation.
# (Routes assemble dicts via to_jsonable; these models are the typed contract.)
class MetricLevelModel(BaseModel):
    """One distortion level's scored metric row (see metrics route)."""

    model_config = ConfigDict(extra="ignore")

    level_index: int
    intensity: float | None
    label: str
    wer: float
    insertions: int
    deletions: int
    substitutions: int
    reference_length: int
    hypothesis_length: int
    confidence: float
    drift_index: float
    semantic_preservation: float
    hallucination_score: float
    severity: str
    is_collapse: bool


class HallucinationTimelinePointModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    level: int
    score: float
    stage: str
    label: str


class DistortionMetricsModel(BaseModel):
    """Per-distortion metrics block."""

    model_config = ConfigDict(extra="ignore")

    levels: list[MetricLevelModel]
    confidence_curve: list[float]
    collapse_rate: float
    collapse_region: int | None
    hallucination_scores: list[float]
    hallucination_threshold: int | None
    hallucination_timeline: list[HallucinationTimelinePointModel]


class MetricsPayloadModel(BaseModel):
    """Full ``GET/POST /api/metrics`` response."""

    model_config = ConfigDict(extra="ignore")

    experiment_id: str
    reference_transcript: str
    distortion_types: list[DistortionType]
    distortions: dict[str, DistortionMetricsModel]
    status: str


class FailureStageModel(BaseModel):
    """One classified failure stage within a report section."""

    model_config = ConfigDict(extra="ignore")

    level: int
    stage_name: str
    wer: float
    confidence: float
    hallucination_score: float
    label: str


class DistortionReportModel(BaseModel):
    """Per-distortion report section (mirrors reports.generator.DistortionReport)."""

    model_config = ConfigDict(extra="ignore")

    distortion_type: str
    overall_robustness: str
    hallucination_threshold_level: int | None
    hallucination_threshold_intensity: float | None
    collapse_point_level: int | None
    collapse_confidence: float | None
    confidence_collapse_rate: float
    peak_hallucination_score: float
    failure_path: list[str]
    stages: list[FailureStageModel]


class ExperimentReportModel(BaseModel):
    """Full ``GET /api/report`` response (mirrors ExperimentReport)."""

    model_config = ConfigDict(extra="ignore")

    experiment_id: str
    filename: str
    duration_seconds: float
    distortions_tested: list[str]
    per_distortion: list[DistortionReportModel]
    most_dangerous_distortion: str
    earliest_hallucination_distortion: str
    earliest_hallucination_level: int
    overall_robustness: str
    executive_summary: str
    generated_at: str


# Hallucination analysis models
class AlteredWordModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    original: list[str]
    output: list[str]


class WordDiffModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    level: int
    hypothesis: str
    preserved: list[str]
    altered: list[AlteredWordModel]
    invented: list[str]
    dropped: list[str]
    counts: dict[str, int]


class SeverityPointModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    level: int
    score: float
    severity: str


class DistortionHallucinationModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    hallucination_scores: list[float]
    hallucination_threshold_level: int | None
    hallucination_threshold_intensity: float | None
    peak_hallucination_score: float
    severities: list[SeverityPointModel]
    word_diff: WordDiffModel | None


class HallucinationAnalysisModel(BaseModel):
    """Full ``GET /api/hallucination`` response."""

    model_config = ConfigDict(extra="ignore")

    experiment_id: str
    reference_transcript: str
    distortions: dict[str, DistortionHallucinationModel]
