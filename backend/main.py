"""
main.py : FastAPI application entrypoint for Audio Illusion Laboratory.

Wires together the API routers under ``api/routes``, configures CORS for the
Next.js frontend (ports 3000/3001), ensures the filesystem store directories
exist, warms up the CPU Whisper model on startup, and installs structured error
handlers.

Run locally:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import config
from api.dependencies import warmup_models
from api.routes import (
    distort,
    hallucination,
    jobs,
    metrics,
    report,
    timeline,
    transcripts,
    upload,
)
from api.schemas import ErrorResponse, HealthResponse
from audio.loader import AudioLoadError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("audio_illusion")

# Frontend dev origins (Next.js). Merged with any configured CORS_ORIGINS.
FRONTEND_ORIGINS = ["http://localhost:3000", "http://localhost:3001"]


def _ensure_storage_dirs() -> None:
    """Create the filesystem store roots (uploads/, cache/, exports/)."""
    for path in (config.UPLOAD_DIR, config.CACHE_DIR, config.EXPORT_DIR):
        path.mkdir(parents=True, exist_ok=True)


def _include_routers(app: FastAPI) -> None:
    """Mount every API router under the ``/api`` prefix."""
    app.include_router(upload.router, prefix=config.API_PREFIX)
    app.include_router(distort.router, prefix=config.API_PREFIX)
    app.include_router(transcripts.router, prefix=config.API_PREFIX)
    app.include_router(metrics.router, prefix=config.API_PREFIX)
    app.include_router(hallucination.router, prefix=config.API_PREFIX)
    app.include_router(jobs.router, prefix=config.API_PREFIX)
    app.include_router(timeline.router, prefix=config.API_PREFIX)
    app.include_router(report.router, prefix=config.API_PREFIX)
    logger.info("Mounted 8 API routers under %s", config.API_PREFIX)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle: ensure storage dirs and warm both models."""
    _ensure_storage_dirs()
    logger.info(
        "Warming models : Whisper '%s' (%s/%s) + embeddings '%s'…",
        config.WHISPER_MODEL,
        config.WHISPER_DEVICE,
        config.WHISPER_COMPUTE_TYPE,
        config.EMBEDDING_MODEL,
    )
    warmup_models()  # best-effort; never fatal
    logger.info("Startup complete.")
    yield
    logger.info("Shutting down.")


def _register_error_handlers(app: FastAPI) -> None:
    """Install structured JSON error handlers for common exceptions."""

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(
                error="http_error", detail=str(exc.detail)
            ).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError):
        # Flatten validation errors into a readable "loc: msg; loc: msg" string.
        parts = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
            msg = err.get("msg", "invalid")
            parts.append(f"{loc}: {msg}" if loc else msg)
        detail = "; ".join(parts) or "Invalid request."
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(error="validation_error", detail=detail).model_dump(),
        )

    @app.exception_handler(AudioLoadError)
    async def audio_load_error_handler(_: Request, exc: AudioLoadError):
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(
                error="audio_load_error", detail=str(exc)
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception):
        logger.exception("Unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error="internal_error", detail="An unexpected error occurred."
            ).model_dump(),
        )


def create_app() -> FastAPI:
    """Construct and configure the FastAPI application."""
    app = FastAPI(
        title="Audio Illusion Laboratory",
        description="An auditory failure observatory for ASR robustness.",
        version="0.1.0",
        lifespan=lifespan,
    )

    origins = sorted(set(FRONTEND_ORIGINS) | set(config.CORS_ORIGINS))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    _include_routers(app)
    _register_error_handlers(app)

    @app.get("/health", response_model=HealthResponse, tags=["meta"])
    async def health() -> HealthResponse:
        """Liveness probe."""
        return HealthResponse(status="ok", model="faster-whisper")

    return app


app = create_app()
