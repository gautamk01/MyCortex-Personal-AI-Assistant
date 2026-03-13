import cron from "node-cron";
import { config } from "./config.js";
import { bot } from "./bot.js";
import {
  formatDailyPlan,
  getDailyPlan,
  getDailyPlanStats,
  reconcileDailyPlanWithTodoist,
} from "./daily-plan.js";
import { getUserStats } from "./memory/sqlite.js";

function buildMorningMessage(chatId: number): string {
  const stats = getUserStats(chatId);
  const plan = getDailyPlan(chatId);

  if (!plan || plan.items.length === 0) {
    return [
      "🌅 Morning Plan",
      "",
      `Level ${stats.level} | ${stats.totalExp} EXP`,
      "",
      "No plan is locked in for today yet.",
      "Reply with:",
      "1. your top 3 must-do tasks",
      "2. any fixed commitments",
      "3. deadlines, energy limits, or time constraints",
      "",
      "I will turn that into a focused day plan and sync it to Todoist.",
    ].join("\n");
  }

  const musts = plan.items.filter((item) => item.priority === "must").slice(0, 3);

  return [
    "🌅 Morning Commitment",
    "",
    `Level ${stats.level} | ${stats.totalExp} EXP`,
    "",
    "Today's plan is already locked in.",
    musts.length > 0 ? "Your must-do items:" : "There are no must-do items yet, so tighten the plan if needed.",
    ...(musts.length > 0 ? musts.map((item) => `- ${item.title}${item.timeBlock ? ` @ ${item.timeBlock}` : ""}`) : []),
    "",
    "Start with the hardest must-do first. Do not drift into low-value work.",
  ].join("\n");
}

async function buildEveningMessage(chatId: number): Promise<string> {
  const plan = await reconcileDailyPlanWithTodoist(chatId);
  const stats = getUserStats(chatId);

  if (!plan || plan.items.length === 0) {
    return [
      "🌙 Evening Reality Check",
      "",
      `Level ${stats.level} | ${stats.totalExp} EXP`,
      "",
      "No daily plan was created today.",
      "That means there was nothing concrete to execute against.",
      "Tomorrow morning starts with planning before anything else.",
    ].join("\n");
  }

  const summary = getDailyPlanStats(plan);
  const openMusts = summary.openMusts.filter((item) => item.status !== "skipped");

  let verdict = "Decent effort, but the plan still needs cleaner execution.";
  if (summary.mustTotal > 0 && summary.mustDone === summary.mustTotal && summary.done === summary.total) {
    verdict = "Strong day. You matched the plan and closed the loop.";
  } else if (summary.mustTotal > 0 && summary.mustDone === 0) {
    verdict = "You missed every must-do item. That is the main failure to explain.";
  } else if (summary.mustTotal > 0 && summary.mustDone < summary.mustTotal) {
    verdict = "You left must-do work unfinished. That is the gap that matters most.";
  }

  return [
    "🌙 Evening Reality Check",
    "",
    `Level ${stats.level} | ${stats.totalExp} EXP`,
    `Completed: ${summary.done}/${summary.total}`,
    `Must-dos done: ${summary.mustDone}/${summary.mustTotal}`,
    `Skipped: ${summary.skipped}`,
    "",
    verdict,
    "",
    ...(openMusts.length > 0
      ? [
          "Still open must-do items:",
          ...openMusts.map((item) => `- ${item.title}`),
          "",
          "Why did these stay open?",
          "",
        ]
      : []),
    formatDailyPlan(plan),
  ].join("\n");
}

async function sendHeartbeatMessage(chatId: number, text: string): Promise<void> {
  await bot.api.sendMessage(chatId, text);
}

export async function sendMorningCheckIn(chatId: number): Promise<void> {
  try {
    await sendHeartbeatMessage(chatId, buildMorningMessage(chatId));
    console.log(`💓 Morning planning prompt sent to chat ${chatId}`);
  } catch (err) {
    console.error("❌ Morning heartbeat failed:", err);
  }
}

export async function sendEveningReview(chatId: number): Promise<void> {
  try {
    await sendHeartbeatMessage(chatId, await buildEveningMessage(chatId));
    console.log(`💓 Evening review sent to chat ${chatId}`);
  } catch (err) {
    console.error("❌ Evening heartbeat failed:", err);
  }
}

let morningTask: cron.ScheduledTask | null = null;
let eveningTask: cron.ScheduledTask | null = null;

export function startHeartbeat(): void {
  const chatId = config.allowedUserIds[0];

  if (!chatId) {
    console.warn("⚠️  No user IDs configured — heartbeat disabled.");
    return;
  }

  morningTask = cron.schedule("0 8 * * *", async () => {
    console.log("💓 Heartbeat firing — Morning Plan");
    await sendMorningCheckIn(chatId);
  }, { timezone: "Asia/Kolkata" });

  eveningTask = cron.schedule("0 20 * * *", async () => {
    console.log("💓 Heartbeat firing — Evening Review");
    await sendEveningReview(chatId);
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
  await sendMorningCheckIn(chatId);
}
