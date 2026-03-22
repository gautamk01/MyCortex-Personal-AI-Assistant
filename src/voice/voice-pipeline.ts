import { config } from "../config.js";
import { localSpeechToText } from "./local-stt.js";
import { textToSpeech } from "../tts.js";
import { elevenLabsQuickTTS } from "./elevenlabs-tts.js";
import { generateToolFiller } from "./groq-filler.js";
import { getRandomFillerAudio } from "./filler-cache.js";
import { runAgentLoop } from "../agent.js";
import { stripTelegramHtml } from "../telegram-html.js";
import type { AgentProgressReporter } from "../agent.js";

/**
 * The core voice pipeline:
 *   Audio Buffer → STT → Agent Loop → TTS → Audio Buffer
 */
export interface VoicePipelineResult {
  transcript: string;
  responseText: string;
  audioBuffer: Buffer | null;
  error?: string;
}

const VOICE_CHAT_ID = Number(config.allowedUserIds[0]) || 0;

// Minimum time between spoken fillers (prevents overlap)
const FILLER_THROTTLE_MS = 1500;

/**
 * Run the full voice pipeline:
 * 1. Transcribe audio → text (local STT)
 * 2. Run agent loop → get response text (with per-tool fillers)
 * 3. Convert response → TTS audio
 */
export async function runVoicePipeline(
  audioBuffer: Buffer,
  chatId?: number,
  onTranscript?: (text: string) => void,
  onProgress?: (text: string) => void,
  onFillerAudio?: (audio: Buffer) => void,
): Promise<VoicePipelineResult> {
  const effectiveChatId = chatId || VOICE_CHAT_ID;

  // ── Filler queue state ──────────────────────────────────────
  let fillersCancelled = false;
  let userTranscript = "";
  let lastFillerSentAt = 0;

  // ── Filler loop state ───────────────────────────────────────
  let isLoopRunning = false;
  let currentFillerPromise: Promise<void> | null = null;
  let activeAudioDurationMs = 0;

  /**
   * Starts a continuous loop that plays pre-cached filler audio phrases
   * back-to-back (with a small gap) until cancelled.
   */
  function startFillerLoop() {
    if (isLoopRunning || fillersCancelled) return;
    isLoopRunning = true;
    console.log(`▶️ Starting continuous filler loop...`);

    const loop = async () => {
      while (isLoopRunning && !fillersCancelled) {
        // Only play a generic filler if no context-aware filler was played recently
        const now = Date.now();
        if (now - lastFillerSentAt > FILLER_THROTTLE_MS) {
          const audio = getRandomFillerAudio();
          if (audio && onFillerAudio) {
            onFillerAudio(audio);
            lastFillerSentAt = Date.now();
            // Estimate duration based on byte size (approx 100kb/sec for TTS)
            activeAudioDurationMs = Math.max(1000, (audio.length / 100000) * 1000);
          }
        }
        
        // Wait for the audio to finish + 500ms gap, checking cancellation midway
        const waitMs = activeAudioDurationMs + 500;
        await new Promise(r => setTimeout(r, waitMs));
      }
    };
    
    currentFillerPromise = loop();
  }

  /**
   * Interrupts the loop to play a specific, context-aware Groq filler (e.g., for a tool call).
   */
  async function triggerContextAwareFiller(toolName: string, toolArgs: string) {
    if (fillersCancelled) return;
    
    // Throttle context-aware fillers
    const now = Date.now();
    if (now - lastFillerSentAt < FILLER_THROTTLE_MS) return;

    try {
      const fillerText = await generateToolFiller(userTranscript, toolName, toolArgs);
      if (!fillerText || fillersCancelled) return;

      console.log(`💬 Context Filler: "${fillerText}"`);
      if (onProgress) onProgress(fillerText);

      // Try ElevenLabs first, fall back to Kokoro
      let audio = await elevenLabsQuickTTS(fillerText);
      if (!audio) {
        audio = await textToSpeech(fillerText);
      }
      
      if (audio && !fillersCancelled && onFillerAudio) {
        lastFillerSentAt = Date.now();
        activeAudioDurationMs = Math.max(1000, (audio.length / 100000) * 1000);
        onFillerAudio(audio);
      }
    } catch (err) {
      console.error("Context filler error:", err);
    }
  }

  const voiceProgress: AgentProgressReporter = {
    update: async (msg: string) => {
      if (fillersCancelled) return;

      // Agent phase events — generate fillers during thinking/memory phases
      if (msg === "checking_memory") {
        if (onProgress) onProgress("🧠 Checking memory...");
        return;
      }
      if (msg === "thinking") {
        if (onProgress) onProgress("💭 Thinking...");
        return;
      }
      if (msg === "writing_response") {
        if (onProgress) onProgress("✍️ Writing response...");
        return;
      }

      // Detect tool call events: "Tool call: funcName({...})"
      const toolCallMatch = msg.match(/^Tool call: ([a-zA-Z0-9_]+)\((.*)?\)$/);
      if (toolCallMatch) {
        const [, toolName, toolArgs] = toolCallMatch;
        if (onProgress) onProgress(`⚙️ Using ${toolName}...`);
        triggerContextAwareFiller(toolName, toolArgs || "");
        return;
      }

      // Detect tool result events — just update UI text, no separate spoken filler
      const toolResultMatch = msg.match(/^Tool result: ([a-zA-Z0-9_]+): (.*)$/);
      if (toolResultMatch) {
        if (onProgress) onProgress(`✅ Got result`);
        return;
      }

      // Other progress — UI only
      if (onProgress) {
        onProgress(msg.replace(/[^a-zA-Z0-9.\s]/g, "").trim());
      }
    },
  };

  // ── Step 1: Speech-to-Text ────────────────────────────────
  console.log(`🎙️ Voice pipeline: transcribing ${audioBuffer.length} bytes for chatId ${effectiveChatId}...`);

  const transcript = await localSpeechToText(audioBuffer, "audio/webm", "voice.webm");

  if (!transcript || transcript.trim().length === 0) {
    return {
      transcript: "",
      responseText: "",
      audioBuffer: null,
      error: "Could not transcribe audio. Make sure the STT server is running and you spoke clearly.",
    };
  }

  const cleaned = transcript.replace(/\.\.\./g, "").trim();
  if (cleaned.length < 2) {
    return {
      transcript: "",
      responseText: "",
      audioBuffer: null,
      error: "Audio too short — hold the button longer and speak clearly.",
    };
  }

  console.log(`🎙️ Transcript: "${transcript}"`);
  userTranscript = transcript;
  if (onTranscript) onTranscript(transcript);

  // ── Step 1.5: Immediate initial filler ────────────────────
  // Start the continuous filler loop to instantly answer and fill all gaps
  startFillerLoop();

  // ── Step 2: Agent Loop (fillers fire per-tool-call) ───────
  console.log(`🧠 Voice pipeline: running agent loop...`);

  const responseText = await runAgentLoop(
    effectiveChatId,
    transcript,
    "terminal",
    voiceProgress,
  );

  // ── Step 3: Generate final TTS (fillers stay ALIVE during this) ──
  // Don't cancel fillers yet! Let them play while we generate the response audio.
  console.log(`🔊 Generating final response TTS (fillers still playing)...`);

  const cleanText = stripTelegramHtml(responseText);
  console.log(`🔊 Voice pipeline: generating TTS for ${cleanText.length} chars...`);

  const ttsAudio = await textToSpeech(cleanText);

  // NOW cancel fillers — the final audio is ready to play
  fillersCancelled = true;
  isLoopRunning = false;
  console.log(`🛑 Fillers cancelled — final audio ready (${ttsAudio ? ttsAudio.length : 0} bytes)`);

  return {
    transcript,
    responseText: cleanText,
    audioBuffer: ttsAudio,
  };
}
