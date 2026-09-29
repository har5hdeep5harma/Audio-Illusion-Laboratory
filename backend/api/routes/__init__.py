"""api.routes : FastAPI APIRouter modules, one per resource.

Modules:
    upload         POST   /api/upload                       - accept & store audio
    distort        POST   /api/distort                      - generate variants
    transcripts    GET    /api/transcripts/{experiment_id}  - Whisper outputs
    metrics        GET    /api/metrics/{experiment_id}      - per-variant metrics
    hallucination  GET    /api/hallucination/{experiment_id}- threshold analysis
    timeline       GET    /api/timeline/{experiment_id}     - trajectory series
    report         GET    /api/report/{experiment_id}       - assembled report
"""
