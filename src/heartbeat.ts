import cron from "node-cron";
import { config } from "./config.js";
import { bot } from "./bot.js";
import { chat, type ChatCompletionMessageParam } from "./llm.js";
import { getMemoryContext, getUserStats } from "./memory/sqlite.js";
import { getGraphContext } from "./memory/knowledge-graph.js";
import { getSemanticContext, isSemanticMemoryEnabled } from "./memory/semantic-memory.js";
import { getHistory } from "./agent.js";
import { getTodayTasks } from "./todoist.js";

// ── Prompts ────────────────────────────────────────────────────

const MORNING_PROMPT = `You are Gautam's personal AI & accountability partner. It is 8:00 AM.
Your task is to send an energizing morning briefing.

## What To Include
1. **The Stats**: Acknowledge his current Gamification Level and total EXP.
2. **The Quote**: Generate or share a strong, hard-hitting motivational quote.
3. **The Plan**: Summarize his Todoist tasks for today.
4. **The Call to Action**: End with a strong "Are we ready to crush this?" message.

## Tone
- Casual, highly energetic, direct.
- Keep it concise (no fluff).

## Memory & Plan Context
`;

const EVENING_PROMPT = `You are Gautam's personal AI & accountability partner. It is 8:00 PM.
Your task is to provide the "Reality Check" - a breakdown of what happened today.

## What To Include
1. **The Reality**: Look at his daily plan (Todoist) vs what is still left. Ask why some tasks weren't done if many are left.
2. **The Score**: Acknowledge his current Gamification Level and total EXP. Did he do LeetCode? Did he build good habits?
3. **The Analysis**: Give him real talk. If he crushed it, praise him. If he slacked, call him out respectfully but firmly.

## Tone
- Objective, direct, analytical, like a friend who won't take excuses.
- Keep it concise (3-4 paragraphs max).

## Memory & Tasks Context
`;

// ── Shared Context Builder ─────────────────────────────────────

async function buildContext(chatId: number): Promise<string> {
  const memCtx = getMemoryContext(chatId);
  const graphCtx = getGraphContext(chatId);
  const stats = getUserStats(chatId);
  
  let semanticCtx = "";
  if (isSemanticMemoryEnabled()) {
    try {
      semanticCtx = await getSemanticContext(chatId, "tasks productivity gamification levels");
    } catch { /* non-critical */ }
  }

  // Fetch today's tasks
  let todoString = "";
  try {
    const tasks = await getTodayTasks();
    if (tasks.length === 0) {
      todoString = "Todoist Plan: No tasks scheduled for today.";
    } else {
      todoString = "Todoist Plan:\n" + tasks.map((t: any) => `- ${t.content}`).join("\n");
    }
  } catch (err) {
    todoString = "Todoist Plan: Could not fetch Todoist tasks.";
  }

  const memoryBlock = [memCtx, graphCtx, semanticCtx].filter(Boolean).join("\n");
  
  return `\n## Your Gamification Stats\nLevel: ${stats.level}\nTotal EXP: ${stats.totalExp}\n\n${todoString}\n\n${memoryBlock}`;
}

// ── Briefings ──────────────────────────────────────────────────

async function sendCheckIn(chatId: number, isMorning: boolean): Promise<void> {
  try {
    const contextStr = await buildContext(chatId);
    const fullPrompt = (isMorning ? MORNING_PROMPT : EVENING_PROMPT) + contextStr;

    const messages: ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: isMorning ? "Send my morning briefing." : "Send my evening reality check.",
      },
    ];

    const systemPrompt =
      `You are Gravity Claw, Gautam's personal AI agent.\n` +
      `You are sending a proactive message. Do NOT use any tools or functions.\n` +
      `Just write a natural, direct message.\n\n` +
      fullPrompt;

    const response = await chat(systemPrompt, messages, []);
    let content = response.choices[0]?.message?.content;

    if (!content) {
      console.error("⚠️  Heartbeat: LLM returned empty response");
      return;
    }

    content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    if (!content) return;

    const prefix = isMorning ? "🌅 **Morning Briefing**\n\n" : "🌙 **Evening Reality Check**\n\n";
    const messageText = prefix + content;

    try {
      await bot.api.sendMessage(chatId, messageText, { parse_mode: "Markdown" });
    } catch {
      await bot.api.sendMessage(chatId, messageText);
    }

    const history = getHistory(chatId);
    history.push({ role: "assistant", content: messageText });

    console.log(`💓 ${isMorning ? 'Morning' : 'Evening'} check-in sent to chat ${chatId}`);
  } catch (err) {
    console.error(`❌ ${isMorning ? 'Morning' : 'Evening'} check-in failed:`, err);
  }
}

// ── Schedule the Heartbeat ─────────────────────────────────────

let morningTask: cron.ScheduledTask | null = null;
let eveningTask: cron.ScheduledTask | null = null;

export function startHeartbeat(): void {
  const chatId = config.allowedUserIds[0];

  if (!chatId) {
    console.warn("⚠️  No user IDs configured — heartbeat disabled.");
    return;
  }

  // Morning: 8:00 AM IST
  morningTask = cron.schedule("0 8 * * *", async () => {
    console.log("💓 Heartbeat firing — Morning Briefing");
    await sendCheckIn(chatId, true);
  }, { timezone: "Asia/Kolkata" });

  // Evening: 8:00 PM IST
  eveningTask = cron.schedule("0 20 * * *", async () => {
    console.log("💓 Heartbeat firing — Evening Reality Check");
    await sendCheckIn(chatId, false);
  }, { timezone: "Asia/Kolkata" });

  console.log("💓 Heartbeats scheduled: 8:00 AM & 8:00 PM IST");
}

export function stopHeartbeat(): void {
  if (morningTask) morningTask.stop();
  if (eveningTask) eveningTask.stop();
  morningTask = null;
  eveningTask = null;
}

export async function sendTestCheckIn(): Promise<void> {
  const chatId = config.allowedUserIds[0];
  if (!chatId) return;
  console.log("💓 Sending test morning briefing...");
  await sendCheckIn(chatId, true);
}
