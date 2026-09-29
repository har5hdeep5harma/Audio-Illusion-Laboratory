"""
timeline.py : GET /api/timeline/{experiment_id}

Returns the per-distortion failure timeline that drives the Transcript Evolution
Observatory. For each distortion type it emits an ordered, per-level list of
``{ level, stage, transcript, confidence, wer, hallucination_score }`` - pairing
the metric trajectory with the actual transcript text at each level so the UI can
show *how the words break down* as distortion intensifies.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

import config
from api.security import experiment_path
from analysis.failure_dynamics import FailureDynamicsAnalyzer

router = APIRouter()

METRICS_PATH = ("metrics", "metrics.json")
TRANSCRIPTS_DIRNAME = "transcripts"

_analyzer = FailureDynamicsAnalyzer()


@router.get(
    "/timeline/{experiment_id}",
    summary="Per-distortion failure timeline for the Observatory.",
)
async def get_timeline(experiment_id: str) -> dict:
    """Return ``{distortion_type: [per-level timeline entries]}``."""
    experiment_dir = experiment_path(experiment_id)
    metrics_path = experiment_dir.joinpath(*METRICS_PATH)
    if not metrics_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No metrics for experiment '{experiment_id}'. "
                "Run POST /api/metrics first."
            ),
        )

    metrics = _load_json(metrics_path)
    transcripts = _load_transcript_texts(experiment_dir / TRANSCRIPTS_DIRNAME)

    timeline: dict[str, list[dict]] = {}
    for dtype, block in metrics.get("distortions", {}).items():
        levels = block.get("levels", [])
        analysis = _analyzer.analyze({**block, "distortion_type": dtype})
        stage_by_level = {s.level: s.stage_name for s in analysis.failure_stages}

        entries: list[dict] = []
        for lv in sorted(levels, key=lambda x: x.get("level_index", 0)):
            level_index = lv.get("level_index", 0)
            entries.append(
                {
                    "level": level_index,
                    "stage": stage_by_level.get(level_index, "unknown"),
                    "transcript": transcripts.get((dtype, level_index), ""),
                    "confidence": float(lv.get("confidence", 0.0)),
                    "wer": float(lv.get("wer", 0.0)),
                    "hallucination_score": float(lv.get("hallucination_score", 0.0)),
                }
            )
        timeline[dtype] = entries

    return timeline


def _load_transcript_texts(transcripts_dir: Path) -> dict[tuple[str, int], str]:
    """Map ``(distortion_type, level_index) -> transcript text``."""
    texts: dict[tuple[str, int], str] = {}
    if not transcripts_dir.is_dir():
        return texts
    for path in transcripts_dir.glob("*_transcript.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        dtype = data.get("distortion_type")
        level = data.get("level_index")
        if dtype is not None and level is not None:
            texts[(dtype, int(level))] = data.get("transcript", "")
    return texts


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read '{path.name}': {exc}",
        ) from exc
