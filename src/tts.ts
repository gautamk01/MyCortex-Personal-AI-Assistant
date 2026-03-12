import { config } from "./config.js";
import { InputFile } from "grammy";

/**
 * Convert text to speech using the local Kokoro TTS server.
 * Returns a Buffer containing OGG audio (Telegram-friendly format),
 * or null if TTS is unavailable.
 */
export async function textToSpeech(text: string): Promise<Buffer | null> {
  if (!config.kokoroUrl) return null;

  // Trim text to avoid generating excessively long audio
  const trimmed = text.slice(0, 2000);

  try {
    const response = await fetch(`${config.kokoroUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: trimmed,
        voice: config.kokoroVoice,
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      console.warn(`⚠️  TTS server returned ${response.status}: ${await response.text()}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    // TTS is optional — if it's down, just skip voice
    console.warn(`⚠️  TTS unavailable: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Create a grammY InputFile from an audio buffer for sending as a voice message.
 */
export function audioToInputFile(buffer: Buffer): InputFile {
  return new InputFile(buffer, "voice.wav");
}
