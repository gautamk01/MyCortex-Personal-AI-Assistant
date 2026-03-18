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
  const reqOptions = {
    max_tokens: options?.maxTokens ?? 4096,
    messages: [
      { role: "system" as const, content: systemPrompt },
      ...messages,
    ],
    tools: tools.length > 0 ? tools : undefined,
  };

  try {
    const res = await client.chat.completions.create({
      model: config.llmModel,
      ...reqOptions,
    });
    return res;
  } catch (error) {
    if (config.backupModel) {
      console.warn(`⚠️ Primary LLM (${config.llmModel}) failed. Falling back to BACKUP_MODEL (${config.backupModel}). Error:`, error instanceof Error ? error.message : error);
      return await client.chat.completions.create({
        model: config.backupModel,
        ...reqOptions,
      });
    }
    throw error;
  }
}
