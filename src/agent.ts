import { config } from "./config.js";
import { getSystemPrompt } from "./prompt.js";
import {
  chat,
  type ChatCompletionMessageParam,
  type ChatCompletionToolCall,
} from "./llm.js";
import { getToolDefinitions, executeTool } from "./tools/index.js";
import { getFullMemoryContext } from "./memory/index.js";
import { pruneContext } from "./memory/context-pruner.js";
import { storeEpisode } from "./memory/semantic-memory.js";
import { autoExtract } from "./memory/auto-extract.js";
import { attemptAutoLog } from "./auto-logging.js";
import { markRecentHeartbeatResponded } from "./coach.js";

export type AgentProgressPhase =
  | "checking_memory"
  | "thinking"
  | "using_tools"
  | "writing_response";

export interface AgentProgressReporter {
  update: (phase: AgentProgressPhase) => void | Promise<void>;
}

// ── Per-chat conversation history ──────────────────────────────

const conversations = new Map<number, ChatCompletionMessageParam[]>();

export function getHistory(chatId: number): ChatCompletionMessageParam[] {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }
  return conversations.get(chatId)!;
}

// ── Agent Loop ─────────────────────────────────────────────────

/**
 * Run the agentic loop: LLM → tool call → LLM → … → final text.
 *
 * Returns the assistant's final text response.
 */
export async function runAgentLoop(
  chatId: number,
  userMessage: string,
  interfaceMode: "gui" | "terminal" = "terminal",
  progress?: AgentProgressReporter,
): Promise<string> {
  const history = getHistory(chatId);
  const tools = getToolDefinitions();
  markRecentHeartbeatResponded(chatId);
  const autoLogNote = await attemptAutoLog(chatId, userMessage).catch(() => null);
  const preparedUserMessage = autoLogNote
    ? `${userMessage}\n\n[System note: ${autoLogNote} Acknowledge it briefly and do not log the same activity again unless the user asks.]`
    : userMessage;

  // Append the user's message
  history.push({ role: "user", content: preparedUserMessage });

  // Auto-prune context if approaching token limits
  pruneContext(history);

  let iterations = 0;

  while (iterations < config.maxAgentIterations) {
    iterations++;

    // Build system prompt with memory context (includes semantic search)
    await progress?.update("checking_memory");
    const memoryContext = await getFullMemoryContext(chatId, userMessage);
    const systemPrompt = getSystemPrompt(interfaceMode) + memoryContext;

    // Call LLM via OpenRouter (with retry for transient errors)
    let response;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await progress?.update("thinking");
        response = await chat(systemPrompt, history, tools);
        break;
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status && status >= 500 && attempt < 3) {
          console.warn(`⚠️  LLM API error (${status}), retrying in ${attempt * 2}s… (attempt ${attempt}/3)`);
          await new Promise((r) => setTimeout(r, attempt * 2000));
          continue;
        }
        throw err; // Non-retryable or final attempt
      }
    }

    const choice = response!.choices[0];

    if (!choice) {
      return "No response from the model. Please try again.";
    }

    const message = choice.message;

    // Append assistant message to history
    history.push({
      role: "assistant",
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    } as ChatCompletionMessageParam);

    // If model is done (no tool calls), return the text
    if (choice.finish_reason === "stop" || !message.tool_calls || message.tool_calls.length === 0) {
      await progress?.update("writing_response");
      const finalText = message.content ?? "I processed your request but have no text response.";

      // Fire-and-forget: store episode in semantic memory + auto-extract
      storeEpisode(chatId, userMessage, finalText).catch(() => {});
      autoExtract(chatId, userMessage, finalText).catch(() => {});

      return finalText;
    }

    // If model wants to use tools, execute them
    if (choice.finish_reason === "tool_calls" || message.tool_calls.length > 0) {
      await progress?.update("using_tools");
      const toolResults = await executeToolCalls(chatId, message.tool_calls);

      // Append each tool result to history
      for (const result of toolResults) {
        history.push(result);
      }

      // Loop back to let the model process the results
      continue;
    }

    // Unexpected finish reason
    console.warn(`⚠️  Unexpected finish_reason: ${choice.finish_reason}`);
    return message.content ?? "Something unexpected happened. Please try again.";
  }

  // Safety limit reached
  console.warn(`⚠️  Agent loop hit max iterations (${config.maxAgentIterations}) for chat ${chatId}`);
  return "I've been thinking about this for too long — let me stop here. Could you rephrase or simplify your request?";
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Execute tool calls and return tool result messages.
 */
async function executeToolCalls(
  chatId: number,
  toolCalls: ChatCompletionToolCall[],
): Promise<ChatCompletionMessageParam[]> {
  const results: ChatCompletionMessageParam[] = [];

  for (const toolCall of toolCalls) {
    const funcName = toolCall.function.name;
    let funcArgs: Record<string, unknown> = {};

    try {
      funcArgs = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      console.warn(`⚠️  Failed to parse tool arguments for ${funcName}`);
    }

    try {
      console.log(`🔧 Tool call: ${funcName}(${JSON.stringify(funcArgs)})`);
      const result = await executeTool(funcName, { ...funcArgs, __chatId: chatId });
      console.log(`✅ Tool result: ${result.slice(0, 200)}`);

      results.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      } as ChatCompletionMessageParam);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Tool error (${funcName}): ${errMsg}`);

      results.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Error: ${errMsg}`,
      } as ChatCompletionMessageParam);
    }
  }

  return results;
}
