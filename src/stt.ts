import { config } from "./config.js";
import axios from "axios";
import FormData from "form-data";
import { localSpeechToText } from "./voice/local-stt.js";

/**
 * Convert audio to text.
 * Tries local faster-whisper first (if available), then falls back to Sarvam AI.
 */
export async function speechToText(
  audioBuffer: Buffer,
  mimeType: string = "audio/ogg",
  filename: string = "voice_message.ogg",
): Promise<string | null> {
  // ── Try local STT first ──────────────────────────────────
  if (config.localSttUrl) {
    const localResult = await localSpeechToText(audioBuffer, mimeType, filename);
    if (localResult) return localResult;
    console.warn("⚠️  Local STT failed or unavailable, trying Sarvam AI fallback...");
  }

  // ── Fallback: Sarvam AI (cloud) ──────────────────────────
  if (!config.sarvamApiKey) {
    console.error("❌ No STT available. Local STT is down and SARVAM_API_KEY is missing.");
    return null;
  }

  try {
    const formData = new FormData();
    formData.append("file", audioBuffer, {
      filename,
      contentType: mimeType,
    });
    formData.append("prompt", "");
    formData.append("model", "saaras:v2.5");

    const res = await axios.post("https://api.sarvam.ai/speech-to-text-translate", formData, {
      headers: {
        "api-subscription-key": config.sarvamApiKey,
        ...formData.getHeaders(),
      },
    });

    return res.data.transcript ?? null;
  } catch (error: any) {
    const status = error.response?.status;
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(
      `⚠️  STT Exception (${status ?? "no-status"}) [mime=${mimeType}] [file=${filename}] [bytes=${audioBuffer.length}]: ${body}`,
    );
    return null;
  }
}
