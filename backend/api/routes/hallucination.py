"""
hallucination.py : GET /api/hallucination/{experiment_id}

Hallucination-focused analysis per distortion type: the timeline of hallucination
scores, the threshold level (first crossing 0.4), per-level severity bands, and a
word-level diff at the hallucination stage, categorizing the reference words
against the model's output as preserved / altered / invented (and dropped). This
exposes *what the model fabricated* at the moment perception breaks.
"""

from __future__ import annotations

import difflib
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

import config
from api.security import experiment_path
from analysis.failure_dynamics import FailureDynamicsAnalyzer
from metrics.hallucination import HallucinationDetector
from metrics.wer import WERCalculator

router = APIRouter()

METRICS_PATH = ("metrics", "metrics.json")
TRANSCRIPTS_DIRNAME = "transcripts"

_analyzer = FailureDynamicsAnalyzer()
_detector = HallucinationDetector()


@router.get(
    "/hallucination/{experiment_id}",
    summary="Hallucination timeline, thresholds, severity, and word-level diff.",
)
async def get_hallucination(experiment_id: str) -> dict:
    """Return hallucination-specific analysis for every distortion type."""
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
    reference = metrics.get("reference_transcript", "")
    transcripts = _load_transcript_texts(experiment_dir / TRANSCRIPTS_DIRNAME)

    distortions: dict[str, dict] = {}
    for dtype, block in metrics.get("distortions", {}).items():
        levels = sorted(block.get("levels", []), key=lambda x: x.get("level_index", 0))
        scores = [float(l.get("hallucination_score", 0.0)) for l in levels]

        analysis = _analyzer.analyze({**block, "distortion_type": dtype})

        # Severity band per level.
        severities = [
            {
                "level": l.get("level_index", i),
                "score": float(l.get("hallucination_score", 0.0)),
                "severity": _detector.classify_severity(
                    float(l.get("hallucination_score", 0.0))
                ),
            }
            for i, l in enumerate(levels)
        ]

        # Pick the level to diff: first level classified as the hallucination
        # stage, else the 0.4-threshold crossing.
        stage_level = next(
            (s.level for s in analysis.failure_stages
             if s.stage_name == "hallucination"),
            None,
        )
        diff_level = (
            stage_level
            if stage_level is not None
            else analysis.hallucination_threshold_level
        )

        word_diff = None
        if diff_level is not None:
            hypothesis = transcripts.get((dtype, diff_level), "")
            word_diff = {
                "level": diff_level,
                "hypothesis": hypothesis,
                **_word_diff(reference, hypothesis),
            }

        distortions[dtype] = {
            "hallucination_scores": scores,
            "hallucination_threshold_level": analysis.hallucination_threshold_level,
            "hallucination_threshold_intensity": (
                analysis.hallucination_threshold_intensity
            ),
            "peak_hallucination_score": analysis.peak_hallucination_score,
            "severities": severities,
            "word_diff": word_diff,
        }

    return {
        "experiment_id": experiment_id,
        "reference_transcript": reference,
        "distortions": distortions,
    }


def _word_diff(reference: str, hypothesis: str) -> dict:
    """Categorize reference vs hypothesis words: preserved/altered/invented/dropped."""
    ref_words = WERCalculator._normalize(reference).split()
    hyp_words = WERCalculator._normalize(hypothesis).split()

    matcher = difflib.SequenceMatcher(a=ref_words, b=hyp_words, autojunk=False)
    preserved: list[str] = []
    altered: list[dict] = []
    invented: list[str] = []
    dropped: list[str] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            preserved.extend(ref_words[i1:i2])
        elif tag == "replace":
            altered.append({"original": ref_words[i1:i2], "output": hyp_words[j1:j2]})
        elif tag == "insert":
            invented.extend(hyp_words[j1:j2])
        elif tag == "delete":
            dropped.extend(ref_words[i1:i2])

    return {
        "preserved": preserved,
        "altered": altered,
        "invented": invented,
        "dropped": dropped,
        "counts": {
            "preserved": len(preserved),
            "altered": sum(len(a["output"]) for a in altered),
            "invented": len(invented),
            "dropped": len(dropped),
        },
    }


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
