import { config } from "./config.js";
import axios from "axios";
import FormData from "form-data";

/**
 * Convert audio to text using Sarvam AI STT mapping for both local and production.
 */
export async function speechToText(
  audioBuffer: Buffer,
  mimeType: string = "audio/ogg",
  filename: string = "voice_message.ogg",
): Promise<string | null> {
  if (!config.sarvamApiKey) {
    console.error("❌ SARVAM_API_KEY is missing. Cannot transcribe audio.");
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
