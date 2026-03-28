import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { config } from "../config.js";
import { runVoicePipeline } from "./voice-pipeline.js";
import { runRealtimePipeline, pcm16ToWav } from "./realtime-pipeline.js";
import { checkLocalSttHealth } from "./local-stt.js";
import type http from "node:http";

/**
 * Voice WebSocket Server — supports both realtime and turn-based modes.
 *
 * Turn-based protocol (existing):
 *   Client → Server: binary (complete audio blob)
 *   Server → Client: JSON status/transcript/response + binary TTS audio
 *
 * Realtime protocol (new):
 *   Client → Server: binary (continuous PCM16 frames at 16kHz, 20ms = 640 bytes each)
 *   Server does VAD, detects speech segments, runs realtime pipeline
 *   Server → Client: JSON rt_status/rt_transcript/rt_tool + binary sentence TTS chunks
 *   Client → Server: JSON { type: "interrupt" } to barge-in
 */

let wss: WebSocketServer | null = null;
let httpServer: http.Server | null = null;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// ── Voice Activity Detector ─────────────────────────────────────

/**
 * Simple energy-based VAD state machine.
 * Detects speech start (energy above threshold for N frames)
 * and speech end (silence for vadSilenceMs).
 */
class VoiceActivityDetector {
  private state: "silence" | "speech" = "silence";
  private speechFrames: Buffer[] = [];
  private silenceFrameCount = 0;
  private speechStartFrameCount = 0;

  // Number of consecutive loud frames needed to declare speech started (~60ms)
  private readonly SPEECH_START_FRAMES = 3;

  // Number of consecutive silent frames to declare speech ended
  // At 20ms/frame: vadSilenceMs / 20
  private readonly SPEECH_END_FRAMES: number;

  constructor(
    private readonly energyThreshold: number,
    vadSilenceMs: number,
  ) {
    this.SPEECH_END_FRAMES = Math.ceil(vadSilenceMs / 20);
  }

  /**
   * Process one 20ms PCM16 frame.
   * Returns:
   *   { event: "speech_start" } — user just started speaking (notify client to show wave)
   *   { event: "speech_end", buffer } — complete speech segment ready for STT
   *   { event: "none" } — no state change worth reporting
   */
  processFrame(frame: Buffer): { event: "speech_start" } | { event: "speech_end"; buffer: Buffer } | { event: "none" } {
    const energy = this.rmsEnergy(frame);

    if (this.state === "silence") {
      if (energy > this.energyThreshold) {
        this.speechStartFrameCount++;
        this.speechFrames.push(frame);

        if (this.speechStartFrameCount >= this.SPEECH_START_FRAMES) {
          this.state = "speech";
          this.silenceFrameCount = 0;
          return { event: "speech_start" };
        }
      } else {
        this.speechStartFrameCount = 0;
        // Keep up to 3 pre-speech frames for natural start
        this.speechFrames = this.speechFrames.slice(-3);
        this.speechFrames.push(frame);
      }
      return { event: "none" };
    }

    // state === "speech"
    this.speechFrames.push(frame);

    if (energy < this.energyThreshold) {
      this.silenceFrameCount++;
      if (this.silenceFrameCount >= this.SPEECH_END_FRAMES) {
        const speechBuffer = Buffer.concat(this.speechFrames);
        this.reset();
        return { event: "speech_end", buffer: speechBuffer };
      }
    } else {
      this.silenceFrameCount = 0;
    }

    return { event: "none" };
  }

  get isSpeaking(): boolean {
    return this.state === "speech";
  }

  reset(): void {
    this.state = "silence";
    this.speechFrames = [];
    this.silenceFrameCount = 0;
    this.speechStartFrameCount = 0;
  }

  private rmsEnergy(buffer: Buffer): number {
    if (buffer.length < 2) return 0;
    let sum = 0;
    const samples = buffer.length >> 1; // divide by 2 (2 bytes per sample)
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i);
      sum += sample * sample;
    }
    return Math.sqrt(sum / samples);
  }
}

// ── Server lifecycle ────────────────────────────────────────────

export function startVoiceServer(server?: http.Server): WebSocketServer {
  const port = config.voiceWsPort;

  if (server) {
    wss = new WebSocketServer({ server, path: "/voice" });
  } else {
    const voiceAgentDir = resolve("./voice-agent");

    httpServer = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      let filePath = req.url === "/" ? "/index.html" : req.url || "/index.html";
      const fullPath = resolve(voiceAgentDir, filePath.slice(1));

      if (!fullPath.startsWith(voiceAgentDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      if (!existsSync(fullPath)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const ext = extname(fullPath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      try {
        const content = readFileSync(fullPath);
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      } catch {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });

    wss = new WebSocketServer({ server: httpServer });
    httpServer.listen(port, () => {
      console.log(`🎤 Voice agent UI:  http://localhost:${port}`);
      console.log(`🎤 Voice WebSocket: ws://localhost:${port}`);
    });
  }

  console.log(`🎤 Voice mode: ${config.voiceMode}`);

  wss.on("connection", (ws, req) => {
    console.log(`🎤 Voice client connected from ${req.socket.remoteAddress}`);

    // ── Per-connection state ──
    let clientChatId: number | undefined;
    const mode = config.voiceMode;

    // Realtime mode state
    const vad = new VoiceActivityDetector(config.vadEnergyThreshold, config.vadSilenceMs);
    let pipelineAbortController: AbortController | null = null;
    let pipelineHasSentAudio = false; // True once the current pipeline has streamed audio to client
    let lastAudioSentAt = 0; // Echo gate: suppress VAD for Nms after sending audio

    function sendJson(data: Record<string, unknown>): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    }

    function sendAudio(audio: Buffer): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(audio);
        lastAudioSentAt = Date.now();
        pipelineHasSentAudio = true;
      }
    }

    // Send initial status + mode
    sendJson({ type: "status", status: "connected" });
    sendJson({ type: "mode", mode });

    ws.on("message", async (data, isBinary) => {
      try {
        if (!isBinary) {
          const msg = JSON.parse(data.toString());

          if (msg.type === "config") {
            clientChatId = msg.chatId;
            console.log(`🎤 Voice client configured: chatId=${clientChatId}, mode=${mode}`);
            const sttHealthy = await checkLocalSttHealth();
            sendJson({ type: "status", status: sttHealthy ? "ready" : "stt_unavailable" });
            return;
          }

          if (msg.type === "ping") {
            sendJson({ type: "pong" });
            return;
          }

          // Barge-in: user interrupts current AI response
          if (msg.type === "interrupt") {
            if (pipelineAbortController) {
              pipelineAbortController.abort();
              pipelineAbortController = null;
            }
            vad.reset();
            sendJson({ type: "rt_status", status: "ready" });
            return;
          }

          return;
        }

        // ── Binary message ──────────────────────────────────────
        const audioBuffer = Buffer.from(data as ArrayBuffer);

        if (mode === "turn-based") {
          // ── Turn-based: complete audio blob ──────────────────
          if (audioBuffer.length < 100) {
            console.warn("🎤 Received very small audio buffer, ignoring");
            return;
          }
          console.log(`🎤 Received audio: ${audioBuffer.length} bytes`);
          sendJson({ type: "status", status: "processing" });

          const result = await runVoicePipeline(
            audioBuffer,
            clientChatId,
            (transcript) => sendJson({ type: "transcript", text: transcript }),
            (progressText) => sendJson({ type: "progress", text: progressText }),
            (fillerAudio) => { sendJson({ type: "status", status: "speaking" }); sendAudio(fillerAudio); },
          );

          if (result.error) {
            sendJson({ type: "error", message: result.error });
            sendJson({ type: "status", status: "ready" });
            return;
          }
          sendJson({ type: "response", text: result.responseText });
          if (result.audioBuffer) {
            sendJson({ type: "status", status: "speaking" });
            sendAudio(result.audioBuffer);
          }
          sendJson({ type: "status", status: "ready" });
          return;
        }

        // ── Realtime: PCM16 streaming frame ──────────────────────
        // Echo gate: suppress VAD while we recently sent audio (prevents AI hearing itself)
        const echoGateMs = 800;
        if (Date.now() - lastAudioSentAt < echoGateMs) {
          return;
        }

        // Pipeline guard — drop ALL frames while active (thinking, tools, speaking).
        // Only explicit interrupt (Space / Hey Leo → { type: "interrupt" }) can barge in.
        if (pipelineAbortController) {
          return;
        }

        const vadResult = vad.processFrame(audioBuffer);

        if (vadResult.event === "speech_start") {
          // User just started speaking — show wave immediately
          sendJson({ type: "vad", speaking: true });
          return;
        }

        if (vadResult.event !== "speech_end") return;

        const speechBuffer = vadResult.buffer;

        // Speech segment ended — let client know + brief visual pause before processing
        sendJson({ type: "vad", speaking: false });

        const chatId = clientChatId ?? (config.allowedUserIds[0] as number) ?? 0;

        const ac = new AbortController();
        pipelineAbortController = ac;
        pipelineHasSentAudio = false;

        // Convert PCM16 to WAV for STT
        const wavBuffer = pcm16ToWav(speechBuffer);

        console.log(`🎤 VAD: speech segment ${speechBuffer.length} bytes → pipeline`);

        // Brief delay so the user sees "heard you" state before thinking starts
        const startPipeline = async () => {
          if (config.vadProcessDelayMs > 0) {
            await new Promise((r) => setTimeout(r, config.vadProcessDelayMs));
          }
          if (ac.signal.aborted) return;
          sendJson({ type: "rt_status", status: "thinking" });
          return runRealtimePipeline(wavBuffer, chatId, sendAudio, sendJson, ac.signal);
        };

        startPipeline()
          .catch((err) => {
            if (!ac.signal.aborted) {
              console.error("🎤 Realtime pipeline error:", err);
              sendJson({ type: "error", message: err instanceof Error ? err.message : "Pipeline error" });
              sendJson({ type: "rt_status", status: "ready" });
            }
          })
          .finally(() => {
            if (pipelineAbortController === ac) {
              pipelineAbortController = null;
            }
          });

      } catch (error) {
        console.error("🎤 Voice server error:", error);
        sendJson({ type: "error", message: error instanceof Error ? error.message : "Unknown error" });
        sendJson({ type: "status", status: "ready" });
      }
    });

    ws.on("close", () => {
      console.log("🎤 Voice client disconnected");
      if (pipelineAbortController) {
        pipelineAbortController.abort();
        pipelineAbortController = null;
      }
    });

    ws.on("error", (error) => {
      console.error("🎤 WebSocket error:", error);
    });
  });

  return wss;
}

export function stopVoiceServer(): void {
  if (wss) {
    wss.close();
    wss = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  console.log("🎤 Voice WebSocket server stopped");
}

export function broadcastVoiceMessage(text: string, audioBuffer: Buffer | null): void {
  if (!wss) return;

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      if (text) {
        client.send(JSON.stringify({ type: "response", text }));
      }
      if (audioBuffer) {
        client.send(JSON.stringify({ type: "status", status: "speaking" }));
        client.send(audioBuffer);
        client.send(JSON.stringify({ type: "status", status: "ready" }));
      }
    }
  }
}
