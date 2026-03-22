import { config } from "../config.js";

/**
 * Ultra-fast filler TTS using ElevenLabs Flash v2.5.
 * Optimized for short text (2-5 words) with maximum latency optimization.
 * Falls back to null if not configured or on error.
 */
export async function elevenLabsQuickTTS(text: string): Promise<Buffer | null> {
  if (!config.elevenLabsApiKey) return null;

  try {
    const voiceId = config.elevenLabsVoiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=4&output_format=mp3_22050_32`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": config.elevenLabsApiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.warn(`⚠️ ElevenLabs TTS failed: ${response.status} — ${errorBody.slice(0, 200)}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error("❌ ElevenLabs TTS error:", err);
    return null;
  }
}
