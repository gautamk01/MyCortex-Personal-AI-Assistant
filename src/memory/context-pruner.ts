import type { ChatCompletionMessageParam } from "../llm.js";
import { config } from "../config.js";

// ── Token Estimation ───────────────────────────────────────────

/**
 * Rough token estimation: ~4 chars per token for English text.
 */
export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    }
  }
  return Math.ceil(totalChars / 4);
}

// ── Auto-Prune ─────────────────────────────────────────────────

/**
 * If token count exceeds maxContextTokens, summarize older messages
 * into a single summary message, keeping the most recent messages intact.
 *
 * Mutates the history array in place.
 */
export function pruneContext(history: ChatCompletionMessageParam[]): boolean {
  const tokens = estimateTokens(history);

  if (tokens <= config.maxContextTokens) {
    return false; // No pruning needed
  }

  // Keep the last N messages (recent context is most important)
  const keepRecent = 6;

  if (history.length <= keepRecent + 1) {
    return false; // Not enough to prune
  }

  const oldMessages = history.slice(0, history.length - keepRecent);
  const recentMessages = history.slice(history.length - keepRecent);

  // Create a summary of old messages
  const summary = summarizeMessages(oldMessages);

  // Replace history in-place
  history.length = 0;
  history.push({
    role: "system",
    content: `[Previous conversation summary]\n${summary}`,
  } as ChatCompletionMessageParam);
  history.push(...recentMessages);

  console.log(
    `🗜️  Pruned context: ${oldMessages.length} messages → summary (${tokens} → ~${estimateTokens(history)} tokens)`
  );
  return true;
}

// ── Force Compact ──────────────────────────────────────────────

/**
 * Force-summarize all but the last 4 messages.
 * Used by the /compact command.
 *
 * Mutates the history array in place.
 */
export function compactHistory(history: ChatCompletionMessageParam[]): string {
  if (history.length <= 4) {
    return "History is already compact — nothing to summarize.";
  }

  const oldMessages = history.slice(0, history.length - 4);
  const recentMessages = history.slice(history.length - 4);

  const summary = summarizeMessages(oldMessages);
  const beforeTokens = estimateTokens(history);

  // Replace history in-place
  history.length = 0;
  history.push({
    role: "system",
    content: `[Previous conversation summary]\n${summary}`,
  } as ChatCompletionMessageParam);
  history.push(...recentMessages);

  const afterTokens = estimateTokens(history);
  return `✅ Compacted ${oldMessages.length} messages into a summary.\nTokens: ~${beforeTokens} → ~${afterTokens} (saved ~${beforeTokens - afterTokens})`;
}

// ── Summarization ──────────────────────────────────────────────

/**
 * Simple heuristic summarization: extract key user questions
 * and assistant answers, compress into bullet points.
 *
 * This is intentionally simple — no LLM call needed.
 */
function summarizeMessages(messages: ChatCompletionMessageParam[]): string {
  const points: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content !== "string" || !msg.content.trim()) continue;

    const role = (msg as { role: string }).role;
    const content = msg.content.trim();

    if (role === "user") {
      // Extract the user's key request/question
      const short =
        content.length > 150
          ? content.slice(0, 150).trim() + "…"
          : content;
      points.push(`• User asked: ${short}`);
    } else if (role === "assistant" && content.length > 0) {
      // Extract the first meaningful line of the assistant's response
      const firstLine = content.split("\n").find((l) => l.trim().length > 10);
      if (firstLine) {
        const short =
          firstLine.length > 150
            ? firstLine.slice(0, 150).trim() + "…"
            : firstLine.trim();
        points.push(`• Assistant: ${short}`);
      }
    } else if (role === "tool") {
      // Mention tool usage briefly
      points.push("• (Tool was used and returned results)");
    }
  }

  // Deduplicate consecutive tool lines
  const deduped: string[] = [];
  for (const p of points) {
    if (
      p === "• (Tool was used and returned results)" &&
      deduped[deduped.length - 1] === p
    ) {
      continue;
    }
    deduped.push(p);
  }

  return deduped.length > 0
    ? deduped.join("\n")
    : "Previous conversation contained minimal content.";
}
