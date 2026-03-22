"""
Faster-Whisper STT Server — FastAPI sidecar for Cortex.
Transcribes audio to text using a local Whisper model.

Usage:
    python server.py
    # or: uvicorn server:app --host 127.0.0.1 --port 8890

API:
    POST /transcribe  (multipart file upload)  → { "transcript": "..." }
    GET  /health  → { "status": "ok" }
"""

import io
import os
import logging
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("whisper-stt")

# ── Global model (loaded at startup) ─────────────────────────────

model = None
MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base.en")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the Whisper model once at startup."""
    global model
    from faster_whisper import WhisperModel

    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = "float32" if device == "cpu" else "float16"

    logger.info(f"Loading faster-whisper model '{MODEL_SIZE}' on {device}...")
    model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute_type)
    logger.info("✅ Whisper model ready")
    yield
    logger.info("Shutting down Whisper STT server")

app = FastAPI(title="Whisper STT Server", lifespan=lifespan)

# Allow CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Endpoints ───────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": MODEL_SIZE,
        "loaded": model is not None,
    }

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not model:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    logger.info(f"STT request: filename={file.filename}, content_type={file.content_type}")

    try:
        # Read uploaded audio into a temp file (faster-whisper needs a file path)
        audio_data = await file.read()
        if len(audio_data) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            tmp.write(audio_data)
            tmp.flush()

            segments, info = model.transcribe(
                tmp.name,
                beam_size=5,
                language="en",
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=300,
                ),
            )

            # Collect all segment texts
            transcript_parts = []
            for segment in segments:
                transcript_parts.append(segment.text.strip())

            transcript = " ".join(transcript_parts).strip()

        logger.info(f"✅ Transcribed: '{transcript[:100]}...' ({info.duration:.1f}s audio)")

        return {
            "transcript": transcript,
            "language": info.language,
            "duration": round(info.duration, 2),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"STT error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Run ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("STT_PORT", 8890))
    logger.info(f"Starting Whisper STT server on http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
