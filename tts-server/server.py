"""
Kokoro TTS Server — FastAPI sidecar for Cortex.
Generates speech audio from text using the Kokoro-82M model.

Usage:
    python server.py
    # or: uvicorn server:app --host 127.0.0.1 --port 8880

API:
    POST /tts  { "text": "Hello", "voice": "af_heart" }  → audio/wav
    GET  /health  → { "status": "ok" }
"""

import io
import os
import logging
from contextlib import asynccontextmanager

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("kokoro-tts")

# ── Global pipeline (loaded at startup) ─────────────────────────

pipeline = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the Kokoro pipeline once at startup."""
    global pipeline
    from kokoro import KPipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Loading Kokoro pipeline on {device}...")
    pipeline = KPipeline(lang_code="a", device=device)
    logger.info("✅ Kokoro pipeline ready")
    yield
    logger.info("Shutting down Kokoro TTS server")

app = FastAPI(title="Kokoro TTS Server", lifespan=lifespan)

# ── Request model ───────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0

# ── Endpoints ───────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "device": str(next(iter(pipeline.model.parameters())).device) if pipeline else "not loaded"}

@app.post("/tts")
async def text_to_speech(req: TTSRequest):
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not loaded yet")

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    logger.info(f"TTS request: {len(req.text)} chars, voice={req.voice}, speed={req.speed}")

    try:
        # Generate all audio segments and concatenate
        audio_segments = []
        generator = pipeline(req.text, voice=req.voice, speed=req.speed)
        for i, (gs, ps, audio) in enumerate(generator):
            audio_segments.append(audio)

        if not audio_segments:
            raise HTTPException(status_code=500, detail="No audio generated")

        # Concatenate all segments
        import numpy as np
        full_audio = np.concatenate(audio_segments)

        # Write to WAV in memory
        buf = io.BytesIO()
        sf.write(buf, full_audio, 24000, format="WAV")
        buf.seek(0)

        logger.info(f"✅ Generated {len(full_audio) / 24000:.1f}s of audio")

        return Response(
            content=buf.read(),
            media_type="audio/wav",
            headers={"X-Audio-Duration": f"{len(full_audio) / 24000:.2f}"}
        )

    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Run ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TTS_PORT", 8880))
    logger.info(f"Starting Kokoro TTS server on http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
