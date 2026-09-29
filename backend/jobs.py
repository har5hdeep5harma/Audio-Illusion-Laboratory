"""Small in-process worker queue for disposable analysis jobs.

This is intentionally dependency-free for the prototype. Production deployments
can replace the executor with Redis/Celery or a managed job runner without
changing the HTTP job contract.
"""

from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

import config


@dataclass
class Job:
    job_id: str
    kind: str
    status: str = "queued"
    progress: float = 0.0
    result: Any = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


_jobs: dict[str, Job] = {}
_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=int(config.JOB_WORKERS), thread_name_prefix="audio-job")


def submit(kind: str, work: Callable[[], Any]) -> Job:
    """Queue work and return its immediately available job record."""
    job = Job(job_id=str(uuid4()), kind=kind)
    with _lock:
        _jobs[job.job_id] = job
    _executor.submit(_run, job.job_id, work)
    return job


def get(job_id: str) -> Job | None:
    with _lock:
        return _jobs.get(job_id)


def as_dict(job: Job) -> dict[str, Any]:
    with _lock:
        return {
            "job_id": job.job_id,
            "kind": job.kind,
            "status": job.status,
            "progress": job.progress,
            "result": job.result,
            "error": job.error,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
        }


def _run(job_id: str, work: Callable[[], Any]) -> None:
    _update(job_id, status="running", progress=0.05)
    try:
        result = work()
        _update(job_id, status="succeeded", progress=1.0, result=_jsonable(result))
    except Exception as exc:  # noqa: BLE001 - surfaced through the job endpoint
        _update(job_id, status="failed", error=str(exc))


def _update(job_id: str, **changes: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        for key, value in changes.items():
            setattr(job, key, value)
        job.updated_at = datetime.now(timezone.utc).isoformat()


def _jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return value
