import type { AgentStreamEvent } from "../agent.js";

export type SentenceEvent =
  | { type: "sentence"; text: string }
  | { type: "tool_start"; name: string; args: string }
  | { type: "tool_done"; name: string; result: string }
  | { type: "done" };

const MIN_CHUNK_CHARS = 20;
const MAX_CHUNK_CHARS = 200;

/**
 * Buffers streaming agent tokens into natural sentence chunks suitable for TTS.
 * Passes tool_start/tool_done events through immediately (after flushing any buffered text).
 */
export async function* chunkIntoSentences(
  tokenStream: AsyncGenerator<AgentStreamEvent>,
): AsyncGenerator<SentenceEvent> {
  let buffer = "";

  for await (const event of tokenStream) {
    if (event.type === "tool_start" || event.type === "tool_done") {
      // Flush any buffered text before tool events
      if (buffer.trim().length > 0) {
        yield { type: "sentence", text: buffer.trim() };
        buffer = "";
      }
      yield event;
      continue;
    }

    if (event.type === "done") {
      // Flush any remaining text
      if (buffer.trim().length > 0) {
        yield { type: "sentence", text: buffer.trim() };
      }
      yield { type: "done" };
      return;
    }

    if (event.type !== "token") continue;

    buffer += event.text;

    // Look for sentence boundary once we have enough text
    if (buffer.length >= MIN_CHUNK_CHARS) {
      const boundaryIdx = findSentenceBoundary(buffer);
      if (boundaryIdx !== -1) {
        const sentence = buffer.slice(0, boundaryIdx + 1).trim();
        buffer = buffer.slice(boundaryIdx + 1).trimStart();
        if (sentence.length > 0) {
          yield { type: "sentence", text: sentence };
        }
      } else if (buffer.length >= MAX_CHUNK_CHARS) {
        // Force break at last word boundary to avoid very long TTS requests
        const lastSpace = buffer.lastIndexOf(" ");
        if (lastSpace > MIN_CHUNK_CHARS) {
          yield { type: "sentence", text: buffer.slice(0, lastSpace).trim() };
          buffer = buffer.slice(lastSpace + 1);
        }
      }
    }
  }
}

/**
 * Returns the index of the first sentence-ending punctuation (.!?) that is
 * followed by whitespace or end-of-string, starting from MIN_CHUNK_CHARS.
 * Returns -1 if no boundary is found.
 */
function findSentenceBoundary(text: string): number {
  for (let i = MIN_CHUNK_CHARS - 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?") {
      if (i + 1 >= text.length || /\s/.test(text[i + 1])) {
        return i;
      }
    }
  }
  return -1;
}
