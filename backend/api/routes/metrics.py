"""
metrics.py : Metrics Engine endpoints.

POST /api/metrics
    Computes the full metric suite for a transcribed experiment. For every
    distortion type, walks its per-level transcripts (ordered, level 0 first) and
    scores each against the clean original transcript: WER, Confidence, Drift
    Index, Semantic Preservation, and Hallucination Score, plus severity staging.
    Per-type it also derives the confidence curve / collapse region and the
    hallucination threshold / timeline. Results are written to
    ``uploads/<experiment_id>/metrics/metrics.json`` and the experiment status is
    advanced to ``"analyzed"``.

GET /api/metrics/{experiment_id}
    Returns the previously-computed ``metrics.json``.

The (heavy) :class:`SemanticAnalyzer` is injected via dependency injection
(``Depends(get_analyzer)``) so it loads once and can be overridden in tests.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status

import config
import jobs
from api.dependencies import get_semantic_analyzer
from api.schemas import MetricsRequest, to_jsonable
from api.security import experiment_path
from metrics.confidence import ConfidenceTracker
from metrics.hallucination import HallucinationDetector
from metrics.semantic import SemanticAnalyzer
from metrics.wer import WERCalculator
from whisper.confidence import ConfidenceExtractor

logger = logging.getLogger("audio_illusion")
router = APIRouter()

TRANSCRIPTS_DIRNAME = "transcripts"
METRICS_DIRNAME = "metrics"
METRICS_FILENAME = "metrics.json"
ORIGINAL_TRANSCRIPT_FILENAME = "original_transcript.json"
ORIGINAL_TYPE = "ORIGINAL"
STATUS_ANALYZED = "analyzed"

_wer = WERCalculator()
_confidence_tracker = ConfidenceTracker()
_detector = HallucinationDetector()
_collapse = ConfidenceExtractor()


@router.post("/metrics", summary="Queue metric computation for an experiment.")
async def compute_metrics(
    payload: MetricsRequest,
    analyzer: SemanticAnalyzer = Depends(get_semantic_analyzer),
) -> dict:
    job = jobs.submit("metrics", lambda: _run_metrics(payload, analyzer))
    return jobs.as_dict(job)


def _run_metrics(
    payload: MetricsRequest, analyzer: SemanticAnalyzer
) -> dict:
    """Score every distortion variant against the clean baseline transcript."""
    logger.info("[%s] metric computation started", payload.experiment_id)
    experiment_dir = experiment_path(payload.experiment_id)
    transcripts_dir = experiment_dir / TRANSCRIPTS_DIRNAME

    if not transcripts_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No transcripts for experiment '{payload.experiment_id}'. "
                "Run POST /api/transcribe first."
            ),
        )

    original, variants_by_type = _load_transcripts(transcripts_dir)
    if original is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original (clean) transcript missing; cannot compute metrics.",
        )

    reference = original.get("transcript", "")

    distortions: dict[str, dict] = {}
    for dtype, transcripts in variants_by_type.items():
        transcripts.sort(key=lambda t: t.get("level_index", 0))
        distortions[dtype] = _analyze_sequence(reference, transcripts, analyzer)

    # Normalize numpy scalars / sets / non-finite floats to JSON-safe natives.
    result = to_jsonable(
        {
            "experiment_id": payload.experiment_id,
            "reference_transcript": reference,
            "distortion_types": sorted(distortions.keys()),
            "distortions": distortions,
            "status": STATUS_ANALYZED,
        }
    )

    metrics_dir = experiment_dir / METRICS_DIRNAME
    metrics_dir.mkdir(parents=True, exist_ok=True)
    _write_json(metrics_dir / METRICS_FILENAME, result)
    _update_status(experiment_dir / "metadata.json", STATUS_ANALYZED)
    logger.info(
        "[%s] metrics computed for %d distortion type(s)",
        payload.experiment_id,
        len(distortions),
    )

    return result


@router.get(
    "/metrics/{experiment_id}",
    summary="Fetch the stored metrics for an experiment.",
)
async def get_metrics(experiment_id: str) -> dict:
    """Return the saved ``metrics.json`` for the experiment."""
    metrics_path = experiment_path(experiment_id) / METRICS_DIRNAME / METRICS_FILENAME
    if not metrics_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No metrics found for experiment '{experiment_id}'. "
                "Run POST /api/metrics first."
            ),
        )
    try:
        return json.loads(metrics_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Corrupted metrics.json: {exc}",
        ) from exc


# analysis 
def _analyze_sequence(
    reference: str, transcripts: list[dict], analyzer: SemanticAnalyzer
) -> dict:
    """Compute per-level rows + per-type aggregates for one distortion type."""
    levels: list[dict] = []
    hallucination_scores: list[float] = []

    for t in transcripts:
        hypothesis = t.get("transcript", "")
        confidence = float(t.get("confidence", 0.0))

        wer_res = _wer.calculate(reference, hypothesis)
        drift = analyzer.compute_drift_index(reference, hypothesis)
        preservation = max(0.0, 1.0 - drift)
        hallucination = analyzer.compute_hallucination_score(
            reference, hypothesis, wer_res.wer
        )
        severity = _detector.classify_severity(hallucination)

        hallucination_scores.append(hallucination)
        levels.append(
            {
                "level_index": t.get("level_index", 0),
                "intensity": t.get("intensity"),
                "label": t.get("label", ""),
                "wer": wer_res.wer,
                "insertions": wer_res.insertions,
                "deletions": wer_res.deletions,
                "substitutions": wer_res.substitutions,
                "reference_length": wer_res.reference_length,
                "hypothesis_length": wer_res.hypothesis_length,
                "confidence": confidence,
                "drift_index": drift,
                "semantic_preservation": preservation,
                "hallucination_score": hallucination,
                "severity": severity,
                "is_collapse": _collapse.is_collapse(confidence, wer_res.wer),
            }
        )

    curve = _confidence_tracker.build_confidence_curve(transcripts)
    return {
        "levels": levels,
        "confidence_curve": curve,
        "collapse_rate": _confidence_tracker.compute_collapse_rate(curve),
        "collapse_region": _confidence_tracker.find_collapse_region(curve),
        "hallucination_scores": hallucination_scores,
        "hallucination_threshold": _detector.detect_threshold(hallucination_scores),
        "hallucination_timeline": _detector.build_hallucination_timeline(
            hallucination_scores
        ),
    }


def _load_transcripts(
    transcripts_dir: Path,
) -> tuple[dict | None, dict[str, list[dict]]]:
    """Load the original transcript and variant transcripts grouped by type."""
    original: dict | None = None
    variants_by_type: dict[str, list[dict]] = {}

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
            continue

        dtype = data.get("distortion_type", ORIGINAL_TYPE)
        if dtype == ORIGINAL_TYPE:
            continue
        variants_by_type.setdefault(dtype, []).append(data)

    return original, variants_by_type


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
