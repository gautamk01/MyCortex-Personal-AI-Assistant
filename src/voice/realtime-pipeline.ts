import { config } from "../config.js";
import { localSpeechToText } from "./local-stt.js";
import { textToSpeech } from "../tts.js";
import { generateToolFiller, generateThinkingOutLoud } from "./groq-filler.js";
import { runAgentLoopStreaming } from "../agent.js";
import { chunkIntoSentences } from "./sentence-chunker.js";
import { stripTelegramHtml } from "../telegram-html.js";
import type { AgentProgressReporter } from "../agent.js";
import { describeToolAction } from "../tools/describe.js";

const FILLER_THROTTLE_MS = 1500;

/**
 * Realtime voice pipeline: speech buffer → STT → streaming LLM → sentence TTS → audio stream.
 *
 * Flow:
 *   1. Transcribe accumulated speech (from VAD)
 *   2. Start Groq filler loop immediately (user hears audio within ~200ms)
 *   3. Stream agent loop in parallel, chunk tokens into sentences
 *   4. TTS each sentence as it completes; cancel fillers on first real audio
 *   5. Stream audio chunks to client continuously
 */
export async function runRealtimePipeline(
  speechBuffer: Buffer,
  chatId: number,
  sendAudio: (chunk: Buffer) => void,
  sendJson: (msg: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {

  // ── Step 1: STT ─────────────────────────────────────────────
  const transcript = await localSpeechToText(speechBuffer, "audio/wav", "voice.wav");

  if (!transcript || transcript.trim().length < 2) {
    sendJson({ type: "rt_status", status: "ready" });
    return;
  }

  const cleaned = transcript.replace(/\.\.\./g, "").trim();
  console.log(`🎙️ Realtime transcript: "${cleaned}"`);
  sendJson({ type: "rt_transcript", role: "user", text: cleaned });
  sendJson({ type: "rt_status", status: "thinking" });

  // ── Step 2: Filler Loop (runs in parallel, zero-delay audio) ──
  let fillersCancelled = false;
  let thoughtQueue: string[] = [];
  let previousThoughtsContext = "";
  let lastToolInjectionAt = 0;

  async function fillerLoop(): Promise<void> {
    while (!fillersCancelled && !signal?.aborted) {
      if (thoughtQueue.length === 0) {
        const newThoughts = await generateThinkingOutLoud(cleaned, previousThoughtsContext);
        if (fillersCancelled || signal?.aborted) return;

        if (newThoughts.length > 0) {
          thoughtQueue = newThoughts;
          previousThoughtsContext += " " + newThoughts.join(" ");
          if (previousThoughtsContext.length > 300) {
            previousThoughtsContext = previousThoughtsContext.slice(-300);
          }
        } else {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
      }

      const thought = thoughtQueue.shift();
      if (!thought || fillersCancelled) continue;

      const audio = await textToSpeech(thought);
      if (audio && !fillersCancelled && !signal?.aborted) {
        sendJson({ type: "rt_status", status: "speaking" });
        sendAudio(audio);
        // Wait for audio to finish: Kokoro WAV is ~48000 bytes/sec at 24kHz 16-bit
        const durationMs = Math.max(1000, (audio.length / 48000) * 1000);
        await new Promise((r) => setTimeout(r, durationMs + 300));
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  // Start filler loop (fire and forget)
  const fillerPromise = fillerLoop();

  // ── Step 3: Streaming Agent Loop ────────────────────────────
  const voiceProgress: AgentProgressReporter = {
    update: async (msg: string) => {
      if (fillersCancelled || signal?.aborted) return;

      const toolCallMatch = msg.match(/^Tool call: ([a-zA-Z0-9_]+)\((.*)\)$/);
      if (toolCallMatch) {
        const [, toolName, toolArgs] = toolCallMatch;
        sendJson({ type: "rt_tool", name: toolName, status: "calling", detail: describeToolAction(toolName, toolArgs || "") });

        // Throttle tool-specific fillers
        const now = Date.now();
        if (now - lastToolInjectionAt >= FILLER_THROTTLE_MS) {
          lastToolInjectionAt = now;
          generateToolFiller(cleaned, toolName, toolArgs || "")
            .then((filler) => {
              if (filler && !fillersCancelled) thoughtQueue.unshift(filler);
            })
            .catch(() => {});
        }
        return;
      }

      const toolResultMatch = msg.match(/^Tool result: ([a-zA-Z0-9_]+): /);
      if (toolResultMatch) {
        const [, toolName] = toolResultMatch;
        sendJson({ type: "rt_tool", name: toolName, status: "done", detail: describeToolAction(toolName, "") });
      }
    },
  };

  // ── Step 4: Sentence-level TTS pipeline ─────────────────────
  let firstRealAudioSent = false;
  let fullResponseText = "";

  const agentStream = runAgentLoopStreaming(chatId, cleaned, "gui", voiceProgress, signal);
  const sentenceStream = chunkIntoSentences(agentStream);

  for await (const event of sentenceStream) {
    if (signal?.aborted) break;

    if (event.type === "sentence") {
      const sentenceText = stripTelegramHtml(event.text);
      fullResponseText += (fullResponseText ? " " : "") + sentenceText;

      // Send subtitle text to client before audio — live captions
      sendJson({ type: "rt_subtitle", text: sentenceText });

      // TTS this sentence
      const audio = await textToSpeech(sentenceText);
      if (audio && !signal?.aborted) {
        if (!firstRealAudioSent) {
          // Cancel fillers — first real audio is ready
          fillersCancelled = true;
          firstRealAudioSent = true;
          // Tell client to flush any queued filler audio before real response starts
          sendJson({ type: "rt_clear_audio" });
          // Brief pause for filler to finish its current word
          await new Promise((r) => setTimeout(r, 100));
        }
        sendJson({ type: "rt_status", status: "speaking" });
        sendAudio(audio);

        // Wait for this sentence to finish playing before sending next
        // (client plays sequentially via audio queue)
        const durationMs = (audio.length / 48000) * 1000;
        await new Promise((r) => setTimeout(r, Math.max(200, durationMs)));
      }
    } else if (event.type === "tool_start") {
      sendJson({ type: "rt_tool", name: event.name, status: "calling", detail: describeToolAction(event.name, event.args) });
    } else if (event.type === "tool_done") {
      sendJson({ type: "rt_tool", name: event.name, status: "done", detail: describeToolAction(event.name, "") });
    } else if (event.type === "done") {
      break;
    }
  }

  // Ensure fillers stop
  fillersCancelled = true;
  await fillerPromise.catch(() => {});

  if (fullResponseText) {
    sendJson({ type: "rt_transcript", role: "assistant", text: fullResponseText });
  }
  sendJson({ type: "rt_status", status: "ready" });
}

/**
 * Wrap a raw PCM16 buffer (16kHz mono) in a WAV header.
 * Used to convert VAD-accumulated frames into a format accepted by STT.
 */
export function pcm16ToWav(pcmBuffer: Buffer, sampleRate = 16000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}
