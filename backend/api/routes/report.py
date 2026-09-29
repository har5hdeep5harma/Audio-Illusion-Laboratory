"""
report.py : GET /api/report/{experiment_id}

Runs the full intelligence stack over a transcribed + analyzed experiment:
FailureDynamicsAnalyzer per distortion type → ThresholdDetector across them →
ReportGenerator → a single :class:`ExperimentReport`. The assembled report is
persisted to ``uploads/<experiment_id>/report.json`` and returned as JSON.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

import config
from analysis.failure_dynamics import FailureDynamicsAnalyzer
from api.schemas import to_jsonable
from api.security import experiment_path, remove_experiment, schedule_cleanup
from reports.generator import ReportGenerator

logger = logging.getLogger("audio_illusion")
router = APIRouter()

METRICS_PATH = ("metrics", "metrics.json")
METADATA_FILENAME = "metadata.json"
REPORT_FILENAME = "report.json"

_analyzer = FailureDynamicsAnalyzer()
_generator = ReportGenerator()


@router.get(
    "/report/{experiment_id}",
    summary="Generate and return the full experiment report.",
)
async def get_report(
    experiment_id: str, background_tasks: BackgroundTasks
) -> dict:
    """Assemble, persist, and return the experiment report."""
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
    metadata = (
        _load_json(experiment_dir / METADATA_FILENAME)
        if (experiment_dir / METADATA_FILENAME).is_file()
        else {}
    )

    distortions: dict[str, dict] = metrics.get("distortions", {})
    if not distortions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Metrics contain no distortion data to report on.",
        )

    analyses = [
        _analyzer.analyze({**block, "distortion_type": dtype})
        for dtype, block in distortions.items()
    ]

    report = _generator.generate(experiment_id, analyses, metadata)
    report_dict = to_jsonable(asdict(report))

    _write_json(experiment_dir / REPORT_FILENAME, report_dict)
    background_tasks.add_task(schedule_cleanup, experiment_id)
    logger.info(
        "[%s] report generated (robustness=%s)",
        experiment_id,
        report_dict.get("overall_robustness"),
    )
    return report_dict


@router.delete(
    "/report/{experiment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Immediately delete temporary experiment artifacts.",
)
async def delete_experiment(experiment_id: str) -> None:
    """Allow clients to discard temporary audio and analysis state early."""
    experiment_path(experiment_id)
    remove_experiment(experiment_id)


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read '{path.name}': {exc}",
        ) from exc


def _write_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
