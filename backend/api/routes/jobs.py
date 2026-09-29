"""GET /api/jobs/{job_id} for background analysis progress."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

import jobs

router = APIRouter()


@router.get("/jobs/{job_id}", summary="Get background analysis job status.")
async def get_job(job_id: str) -> dict:
    """Return queued, running, succeeded, or failed job state."""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found or expired.",
        )
    return jobs.as_dict(job)
