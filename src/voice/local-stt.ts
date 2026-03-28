import { config } from "../config.js";

/**
 * Transcribe audio using Sarvam AI (if configured) or the local faster-whisper STT server.
 * Returns the transcript text, or null if STT is unavailable.
 */
export async function localSpeechToText(
  audioBuffer: Buffer,
  mimeType: string = "audio/wav",
  filename: string = "voice.wav",
): Promise<string | null> {
  
  // ── Sarvam AI Server (Primary) ──────────────────────────────────
  // Skip Sarvam for very short buffers (< 0.5s of audio incl. WAV header) — it rejects them with 400
  const MIN_SARVAM_BYTES = 16044; // 44-byte WAV header + 16000 bytes (0.5s at 16kHz 16-bit mono)
  if (config.sarvamApiKey && audioBuffer.length >= MIN_SARVAM_BYTES) {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
      formData.append("file", blob, filename);

      const res = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: {
          "api-subscription-key": config.sarvamApiKey,
        },
        signal: AbortSignal.timeout(15_000),
        body: formData,
      });

      if (res.ok) {
        const data = (await res.json()) as { transcript: string; language_code: string };
        if (data.transcript) {
          return data.transcript;
        }
      } else {
        const errText = await res.text();
        console.warn(`⚠️  Sarvam STT failed (${res.status}): ${errText}`);
      }
    } catch (err) {
      console.warn(`⚠️  Sarvam STT error: ${err instanceof Error ? err.message : err}`);
    }
    console.log("⚠️  Sarvam failed, falling back to local STT...");
  }

  // ── Local Server (Fallback) ─────────────────────────────────────
  if (!config.localSttUrl) {
    console.warn("⚠️  Local STT skipped: LOCAL_STT_URL is not configured.");
    return null;
  }

  try {
    // Build multipart form data manually using fetch-compatible FormData
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", blob, filename);

    const res = await fetch(`${config.localSttUrl}/transcribe`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`⚠️  Local STT failed (${res.status}): ${errText}`);
      return null;
    }

    const data = (await res.json()) as { transcript: string; language: string; duration: number };
    return data.transcript || null;
  } catch (error) {
    console.warn(`⚠️  Local STT unavailable: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Check if the local STT server is healthy and reachable.
 */
export async function checkLocalSttHealth(): Promise<boolean> {
  if (!config.localSttUrl) return false;

  try {
    const res = await fetch(`${config.localSttUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
