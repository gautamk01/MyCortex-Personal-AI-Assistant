import { config } from "./config.js";
import { fetch } from "undici"; // GramMY uses undici under the hood in newer Node

/**
 * Convert audio to text using Sarvam AI STT in production.
 * If local, returns a mock string since local STT is not configured.
 */
export async function speechToText(audioBuffer: Buffer, mimeType: string = "audio/ogg"): Promise<string | null> {
  // Local development fallback
  if (!process.env.RAILWAY_ENVIRONMENT_NAME) {
    console.log("🎙️  [Local] STT triggered, but no local STT model is configured.");
    return "(Local STT fallback: Pretend the user said 'Hello')\n\n*Note: Local STT is not currently configured.*";
  }

  // Production (Railway) handling using Sarvam AI
  if (!config.sarvamApiKey) {
    console.error("❌ SARVAM_API_KEY is missing. Cannot transcribe audio.");
    return null;
  }

  try {
    const fileBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    const formData = new FormData();
    formData.append('file', fileBlob, 'voice_message.ogg');
    formData.append('model', 'saaras:v3');

    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: {
        "api-subscription-key": config.sarvamApiKey
      },
      body: formData as any
    });

    if (!res.ok) {
      console.error(`⚠️  Sarvam STT Failed (${res.status}): ${await res.text()}`);
      return null;
    }

    const data = await res.json() as any;
    return data.transcript ?? null;
  } catch (error) {
    console.error(`⚠️  STT Exception: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
