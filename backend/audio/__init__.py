"""audio : input audio handling: loading, validation, and resampling.

Turns an arbitrary uploaded file into the canonical 16 kHz mono signal that the
rest of the pipeline (distortions, whisper) operates on.
"""
