import { config } from "../config.js";
import { localSpeechToText } from "./local-stt.js";
import { textToSpeech } from "../tts.js";
import { runAgentLoop } from "../agent.js";
import { stripTelegramHtml } from "../telegram-html.js";
import type { AgentProgressReporter } from "../agent.js";

/**
 * The core voice pipeline:
 *   Audio Buffer → STT → Agent Loop → TTS → Audio Buffer
 *
 * Returns both the text response and TTS audio buffer.
 */
export interface VoicePipelineResult {
  transcript: string;
  responseText: string;
  audioBuffer: Buffer | null;
  error?: string;
}

const VOICE_CHAT_ID = Number(config.allowedUserIds[0]) || 0;

/**
 * Noop progress reporter for voice pipeline (no Telegram status messages).
 */
const voiceProgress: AgentProgressReporter = {
  update: async () => {},
};

/**
 * Run the full voice pipeline:
 * 1. Transcribe audio → text (local STT)
 * 2. Run agent loop → get response text
 * 3. Convert response → TTS audio
 */
export async function runVoicePipeline(
  audioBuffer: Buffer,
  chatId?: number,
): Promise<VoicePipelineResult> {
  const effectiveChatId = chatId || VOICE_CHAT_ID;

  // ── Step 1: Speech-to-Text ────────────────────────────────
  console.log(`🎙️ Voice pipeline: transcribing ${audioBuffer.length} bytes for chatId ${effectiveChatId}...`);

  // Browser sends WebM/Opus — pass the correct MIME type and extension
  const transcript = await localSpeechToText(audioBuffer, "audio/webm", "voice.webm");

  if (!transcript || transcript.trim().length === 0) {
    return {
      transcript: "",
      responseText: "",
      audioBuffer: null,
      error: "Could not transcribe audio. Make sure the STT server is running and you spoke clearly.",
    };
  }

  // Filter out junk transcriptions (Whisper sometimes hallucinates with very short audio)
  const cleaned = transcript.replace(/\.\.\./g, '').trim();
  if (cleaned.length < 2) {
    return {
      transcript: "",
      responseText: "",
      audioBuffer: null,
      error: "Audio too short — hold the button longer and speak clearly.",
    };
  }

  console.log(`🎙️ Transcript: "${transcript}"`);

  // ── Step 2: Agent Loop ────────────────────────────────────
  console.log(`🧠 Voice pipeline: running agent loop...`);

  const responseText = await runAgentLoop(
    effectiveChatId,
    transcript,
    "terminal",
    voiceProgress,
  );

  // Strip Telegram HTML formatting for TTS
  const cleanText = stripTelegramHtml(responseText);

  // ── Step 3: Text-to-Speech ────────────────────────────────
  console.log(`🔊 Voice pipeline: generating TTS for ${cleanText.length} chars...`);

  const ttsAudio = await textToSpeech(cleanText);

  console.log(`✅ Voice pipeline complete (audio: ${ttsAudio ? ttsAudio.length : 0} bytes)`);

  return {
    transcript,
    responseText: cleanText,
    audioBuffer: ttsAudio,
  };
}
