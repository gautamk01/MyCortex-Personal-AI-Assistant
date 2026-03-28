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

export type LLMStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_calls"; calls: ChatCompletionToolCall[] }
  | { type: "finish"; reason: string };

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

// ── Streaming chat function ─────────────────────────────────────

/**
 * Stream a conversation from the LLM, yielding tokens and tool calls incrementally.
 * Yields LLMStreamEvent objects: text_delta for tokens, tool_calls when all tool
 * call arguments are accumulated, and finish when the stream ends.
 */
export async function* chatStream(
  systemPrompt: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  options?: { maxTokens?: number },
  signal?: AbortSignal,
): AsyncGenerator<LLMStreamEvent> {
  const reqOptions = {
    max_tokens: options?.maxTokens ?? 4096,
    messages: [
      { role: "system" as const, content: systemPrompt },
      ...messages,
    ],
    tools: tools.length > 0 ? tools : undefined,
    stream: true as const,
  };

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

  try {
    stream = await client.chat.completions.create(
      { model: config.llmModel, ...reqOptions },
      { signal },
    );
  } catch (error) {
    // Don't fallback on intentional abort — re-throw immediately
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    if (config.backupModel) {
      console.warn(`⚠️ Primary LLM (${config.llmModel}) stream failed. Falling back to BACKUP_MODEL (${config.backupModel}). Error:`, error instanceof Error ? error.message : error);
      stream = await client.chat.completions.create(
        { model: config.backupModel, ...reqOptions },
        { signal },
      );
    } else {
      throw error;
    }
  }

  // Accumulate tool call chunks by index
  const toolCallMap: Record<number, { id: string; name: string; arguments: string }> = {};

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const finishReason = chunk.choices[0]?.finish_reason;

    if (delta?.content) {
      yield { type: "text_delta", delta: delta.content };
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallMap[idx]) {
          toolCallMap[idx] = { id: "", name: "", arguments: "" };
        }
        if (tc.id) toolCallMap[idx].id = tc.id;
        if (tc.function?.name) toolCallMap[idx].name += tc.function.name;
        if (tc.function?.arguments) toolCallMap[idx].arguments += tc.function.arguments;
      }
    }

    if (finishReason) {
      if (finishReason === "tool_calls") {
        const calls: ChatCompletionToolCall[] = Object.values(toolCallMap).map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
        yield { type: "tool_calls", calls };
      }
      yield { type: "finish", reason: finishReason };
    }
  }
}
