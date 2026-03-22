import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { config } from "../config.js";
import { runVoicePipeline } from "./voice-pipeline.js";
import { checkLocalSttHealth } from "./local-stt.js";
import type http from "node:http";

/**
 * Voice WebSocket Server for the JARVIS-like voice agent.
 *
 * Protocol:
 *   Client → Server:
 *     - Binary messages: audio data (WAV/WebM chunks)
 *     - JSON text messages: { type: "config", chatId: number }
 *
 *   Server → Client:
 *     - JSON text: { type: "transcript", text: "..." }
 *     - JSON text: { type: "response", text: "..." }
 *     - Binary: TTS audio buffer (WAV)
 *     - JSON text: { type: "error", message: "..." }
 *     - JSON text: { type: "status", status: "listening" | "processing" | "speaking" }
 */

let wss: WebSocketServer | null = null;
let httpServer: http.Server | null = null;

// MIME types for static file serving
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function startVoiceServer(server?: http.Server): WebSocketServer {
  const port = config.voiceWsPort;

  if (server) {
    wss = new WebSocketServer({ server, path: "/voice" });
  } else {
    // Create an HTTP server that serves static files from voice-agent/
    const voiceAgentDir = resolve("./voice-agent");

    httpServer = createServer((req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      let filePath = req.url === "/" ? "/index.html" : req.url || "/index.html";
      const fullPath = resolve(voiceAgentDir, filePath.slice(1));

      // Security: prevent path traversal
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

  console.log(`🎤 Voice WebSocket server listening on ${server ? "attached to HTTP server at /voice" : `ws://localhost:${port}`}`);

  wss.on("connection", (ws, req) => {
    console.log(`🎤 Voice client connected from ${req.socket.remoteAddress}`);
    let clientChatId: number | undefined;

    // Send initial status
    sendJson(ws, { type: "status", status: "connected" });

    ws.on("message", async (data, isBinary) => {
      try {
        if (!isBinary) {
          // Text message — parse as JSON command
          const msg = JSON.parse(data.toString());

          if (msg.type === "config") {
            clientChatId = msg.chatId;
            console.log(`🎤 Voice client configured: chatId=${clientChatId}`);

            // Check STT health and report
            const sttHealthy = await checkLocalSttHealth();
            sendJson(ws, {
              type: "status",
              status: sttHealthy ? "ready" : "stt_unavailable",
            });
            return;
          }

          if (msg.type === "ping") {
            sendJson(ws, { type: "pong" });
            return;
          }

          return;
        }

        // Binary message — audio data
        const audioBuffer = Buffer.from(data as ArrayBuffer);

        if (audioBuffer.length < 100) {
          console.warn("🎤 Received very small audio buffer, ignoring");
          return;
        }

        console.log(`🎤 Received audio: ${audioBuffer.length} bytes`);
        sendJson(ws, { type: "status", status: "processing" });

        // Run the full voice pipeline
        const result = await runVoicePipeline(audioBuffer, clientChatId);

        if (result.error) {
          sendJson(ws, { type: "error", message: result.error });
          sendJson(ws, { type: "status", status: "ready" });
          return;
        }

        // Send transcript
        sendJson(ws, { type: "transcript", text: result.transcript });

        // Send text response
        sendJson(ws, { type: "response", text: result.responseText });

        // Send TTS audio
        if (result.audioBuffer) {
          sendJson(ws, { type: "status", status: "speaking" });
          ws.send(result.audioBuffer);
        }

        sendJson(ws, { type: "status", status: "ready" });
      } catch (error) {
        console.error("🎤 Voice server error:", error);
        sendJson(ws, {
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        sendJson(ws, { type: "status", status: "ready" });
      }
    });

    ws.on("close", () => {
      console.log("🎤 Voice client disconnected");
    });

    ws.on("error", (error) => {
      console.error("🎤 WebSocket error:", error);
    });
  });

  return wss;
}

function sendJson(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
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
