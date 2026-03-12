import cron from "node-cron";
import { config } from "./config.js";
import { bot } from "./bot.js";
import { chat, type ChatCompletionMessageParam } from "./llm.js";
import { getMemoryContext } from "./memory/sqlite.js";
import { getGraphContext } from "./memory/knowledge-graph.js";
import { getSemanticContext, isSemanticMemoryEnabled } from "./memory/semantic-memory.js";
import { getHistory } from "./agent.js";

// ── Heartbeat Check-in Prompt ──────────────────────────────────

const CHECKIN_PROMPT = `You are sending a proactive daily check-in message to Gautam about his LeetCode practice.

## Your Task
Generate a personalized, casual check-in message. You're his accountability partner, not a nagging bot.

## What To Include
1. **Ask about today's practice** — did he solve a problem? Which topic? What was hard?
2. **Offer to suggest a problem** for tomorrow based on his weak areas or what he hasn't practiced recently.
3. **Encourage consistency** — remind him small daily progress compounds, but don't be corny about it.
4. **Reference his memory** — use the stored facts and past conversations below to personalize. Mention specific topics he's been working on, areas he struggles with, or patterns you notice.

## Tone
- Casual, direct, like a friend who actually gives a damn about his progress.
- If the memory shows he's been consistent, acknowledge it.
- If it looks like he's been MIA, gently call it out — no guilt trips, just straight talk.
- Keep it short (3-5 paragraphs max). Don't write an essay.

## Memory Context (use this to personalize)
`;

// ── Core Heartbeat Functions ───────────────────────────────────

/**
 * Generate and send a personalized LeetCode check-in message.
 */
export async function sendCheckIn(chatId: number): Promise<void> {
  try {
    // Gather all memory context for personalization
    const memCtx = getMemoryContext(chatId);
    const graphCtx = getGraphContext(chatId);
    let semanticCtx = "";

    if (isSemanticMemoryEnabled()) {
      try {
        semanticCtx = await getSemanticContext(chatId, "LeetCode practice coding problems algorithms data structures");
      } catch { /* non-critical */ }
    }

    const memoryBlock = [memCtx, graphCtx, semanticCtx]
      .filter(Boolean)
      .join("\n") || "No stored memories yet — this is the first check-in.";

    const fullPrompt = CHECKIN_PROMPT + memoryBlock;

    const messages: ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: "Send me my daily LeetCode check-in message. Use my memory to make it personal.",
      },
    ];

    // Use a clean prompt WITHOUT tool descriptions — heartbeat should never trigger tools
    const systemPrompt =
      `You are Gravity Claw, Gautam's personal AI agent and accountability partner.\n` +
      `You are sending a proactive daily check-in message. Do NOT use any tools or functions.\n` +
      `Just write a natural, casual message directly.\n\n` +
      fullPrompt;

    const response = await chat(systemPrompt, messages, []);
    let content = response.choices[0]?.message?.content;

    if (!content) {
      console.error("⚠️  Heartbeat: LLM returned empty response");
      return;
    }

    // Strip any accidental tool call XML the LLM might emit
    content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    // Strip thinking tags too
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    if (!content) return;

    // Send to Telegram (try Markdown first, fall back to plain text)
    const messageText = `💪 Daily LeetCode Check-In\n\n${content}`;
    try {
      await bot.api.sendMessage(chatId, messageText, { parse_mode: "Markdown" });
    } catch {
      // Markdown parsing failed — send as plain text
      await bot.api.sendMessage(chatId, messageText);
    }

    // Push into agent history so the bot contextually remembers sending this message
    const history = getHistory(chatId);
    history.push({ role: "assistant", content: messageText });

    console.log(`💓 Heartbeat check-in sent to chat ${chatId}`);
  } catch (err) {
    console.error("❌ Heartbeat check-in failed:", err);

    // Fallback: send a static message so the user still gets reminded
    try {
      await bot.api.sendMessage(
        chatId,
        "💪 Hey Gautam! Quick daily check —\n\n" +
          "• Did you solve a LeetCode problem today?\n" +
          "• Which topic did you practice? (arrays, DP, graphs, etc.)\n" +
          "• What was the hardest part?\n" +
          "• Want me to suggest a problem for tomorrow?\n\n" +
          "Small daily progress compounds. Don't break the streak! 🔥"
      );
    } catch (fallbackErr) {
      console.error("❌ Heartbeat fallback also failed:", fallbackErr);
    }
  }
}

// ── Schedule the Heartbeat ─────────────────────────────────────

let heartbeatTask: cron.ScheduledTask | null = null;

/**
 * Start the daily 8 PM IST heartbeat cron job.
 * Cron: "0 20 * * *" in Asia/Kolkata timezone = 8:00 PM IST every day.
 */
export function startHeartbeat(): void {
  const chatId = config.allowedUserIds[0]; // Primary user

  if (!chatId) {
    console.warn("⚠️  No user IDs configured — heartbeat disabled.");
    return;
  }

  // 8 PM IST every day
  heartbeatTask = cron.schedule(
    "0 20 * * *",
    async () => {
      console.log("💓 Heartbeat firing — daily LeetCode check-in");
      await sendCheckIn(chatId);
    },
    { timezone: "Asia/Kolkata" }
  );

  console.log("💓 Heartbeat scheduled: daily LeetCode check-in at 8:00 PM IST");
}

/**
 * Stop the heartbeat cron job.
 */
export function stopHeartbeat(): void {
  if (heartbeatTask) {
    heartbeatTask.stop();
    heartbeatTask = null;
  }
}

/**
 * Send an immediate test check-in (for debugging/verification).
 */
export async function sendTestCheckIn(): Promise<void> {
  const chatId = config.allowedUserIds[0];
  if (!chatId) {
    console.warn("⚠️  No user IDs configured — can't send test check-in.");
    return;
  }

  console.log("💓 Sending test heartbeat check-in...");
  await sendCheckIn(chatId);
}
