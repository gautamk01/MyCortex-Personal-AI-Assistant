import OpenAI from "openai";
import { config } from "./config.js";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

// ── Singleton client (works with Ollama, OpenRouter, or any OpenAI-compatible API) ──

const client = new OpenAI({
  baseURL: config.llmBaseUrl,
  apiKey: config.llmApiKey,
});

// ── Re-export types ────────────────────────────────────────────

export type { ChatCompletionMessageParam, ChatCompletionTool };
export type ChatCompletionMessage = OpenAI.Chat.Completions.ChatCompletionMessage;
export type ChatCompletionToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

// ── Chat function ──────────────────────────────────────────────

/**
 * Send a conversation to the LLM.
 * Returns the raw API response so the agent loop can inspect finish_reason.
 */
export async function chat(
  systemPrompt: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  options?: {
    maxTokens?: number;
  },
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return client.chat.completions.create({
    model: config.llmModel,
    max_tokens: options?.maxTokens ?? 4096,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    tools: tools.length > 0 ? tools : undefined,
  });
}
