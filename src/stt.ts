import { config } from "./config.js";
import axios from "axios";
import FormData from "form-data";

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
    const formData = new FormData();
    // Pass the buffer directly with explicit filename and mime type
    formData.append("file", audioBuffer, {
      filename: "voice_message.ogg",
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
    const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`⚠️  STT Exception: ${errMsg}`);
    return null;
  }
}
