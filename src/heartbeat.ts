import cron from "node-cron";
import { chat, type ChatCompletionMessageParam } from "./llm.js";
import { config } from "./config.js";
import { sendTelegramText } from "./bot.js";
import {
  buildHourlySnapshot,
  chooseHeartbeatTone,
  collectDailySummaryMetrics,
  generateDailySummaryText,
  getCoachProfile,
  getRecentHeartbeatThemes,
  recordHeartbeatEvent,
  storeDailySummary,
  type CoachToneMode,
  type HeartbeatTheme,
} from "./coach.js";
import {
  formatDailyPlan,
  getDailyPlan,
  getDailyPlanStats,
  getTodayPlanDate,
  reconcileDailyPlanWithTodoist,
} from "./daily-plan.js";
import { getUserStats } from "./memory/sqlite.js";

function getISTDateTime(date = new Date()): { date: string; time: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";

  return {
    date: `${year}-${month}-${day}`,
    time: `${String(hour).padStart(2, "0")}:${minute}`,
    hour,
  };
}

function getYesterdayDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return getISTDateTime(date).date;
}

function buildMorningMessage(chatId: number): string {
  const stats = getUserStats(chatId);
  const plan = getDailyPlan(chatId);

  if (!plan || plan.items.length === 0) {
    return [
      "Morning plan.",
      `Level ${stats.level} | ${stats.totalExp} EXP`,
      "No plan is locked in yet.",
      "Reply with your top 3 must-dos and constraints.",
    ].join("\n");
  }

  const musts = plan.items.filter((item) => item.priority === "must").slice(0, 3);

  return [
    "Morning commitment.",
    `Level ${stats.level} | ${stats.totalExp} EXP`,
    musts.length > 0
      ? `Must-dos: ${musts.map((item) => `${item.title}${item.timeBlock ? ` @ ${item.timeBlock}` : ""}`).join(" | ")}`
      : "No must-do items yet. Tighten the plan.",
    "Start with the hardest thing first.",
  ].join("\n");
}

async function buildEveningMessage(chatId: number): Promise<string> {
  const plan = await reconcileDailyPlanWithTodoist(chatId);
  const stats = getUserStats(chatId);

  if (!plan || plan.items.length === 0) {
    return [
      "Evening reality check.",
      `Level ${stats.level} | ${stats.totalExp} EXP`,
      "No daily plan existed today.",
      "Tomorrow starts with planning before drift.",
    ].join("\n");
  }

  const summary = getDailyPlanStats(plan);
  const openMusts = summary.openMusts.filter((item) => item.status !== "skipped");

  let verdict = "Execution was mixed. Clean it up tomorrow.";
  if (summary.mustTotal > 0 && summary.mustDone === summary.mustTotal && summary.done === summary.total) {
    verdict = "Strong day. You matched the plan.";
  } else if (summary.mustTotal > 0 && summary.mustDone === 0) {
    verdict = "You missed every must-do. That is the failure to explain.";
  } else if (summary.mustTotal > 0 && summary.mustDone < summary.mustTotal) {
    verdict = "Must-do work was left open. That matters most.";
  }

  return [
    "Evening reality check.",
    `Level ${stats.level} | ${stats.totalExp} EXP`,
    `Completed ${summary.done}/${summary.total} | Must-dos ${summary.mustDone}/${summary.mustTotal} | Skipped ${summary.skipped}`,
    verdict,
    ...(openMusts.length > 0 ? [`Open musts: ${openMusts.map((item) => item.title).join(" | ")}`] : []),
    formatDailyPlan(plan),
  ].join("\n");
}

async function sendHeartbeatMessage(chatId: number, text: string): Promise<void> {
  await sendTelegramText(chatId, text);
}

function chooseTheme(snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>): {
  theme: HeartbeatTheme;
  reason: string;
} {
  const recent = new Set(snapshot.recentThemes);
  const plan = snapshot.plan ? getDailyPlanStats(snapshot.plan) : null;

  if (!snapshot.plan || snapshot.plan.items.length === 0) {
    return { theme: "plan", reason: "no_plan" };
  }

  if (snapshot.reminders.length > 0 && !recent.has("reminder")) {
    return { theme: "reminder", reason: "active_reminders" };
  }

  if (snapshot.work.totalMinutes === 0 && !recent.has("work_log")) {
    return { theme: "work_log", reason: "no_work_log_today" };
  }

  if (snapshot.life.timeline.length === 0 && !recent.has("life_log")) {
    return { theme: "life_log", reason: "no_life_log_today" };
  }

  if (plan && plan.openMusts.length > 0 && !recent.has("focus")) {
    return { theme: "focus", reason: "open_musts" };
  }

  if (snapshot.life.breakMinutes > snapshot.life.focusedMinutes && !recent.has("drift")) {
    return { theme: "drift", reason: "breaks_exceed_focus" };
  }

  const rotation: HeartbeatTheme[] = [
    "focus",
    "work_log",
    "life_log",
    "reflection",
    "break",
    "plan",
  ];

  const fallback = rotation.find((theme) => !recent.has(theme)) ?? "reflection";
  return { theme: fallback, reason: "rotation" };
}

function buildToneInstruction(tone: CoachToneMode): string {
  switch (tone) {
    case "strict":
      return "Be direct, crisp, and demanding. No softness.";
    case "supportive":
      return "Be gentle, encouraging, and brief.";
    case "warm_firm":
      return "Be warm but firm. Encourage, then push for action.";
    case "normal":
    default:
      return "Be concise, clear, and lightly demanding.";
  }
}

function buildHourlyPrompt(
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
  theme: HeartbeatTheme,
  tone: CoachToneMode,
): string {
  const planStats = snapshot.plan ? getDailyPlanStats(snapshot.plan) : null;
  const planSummary = planStats
    ? {
        total: planStats.total,
        done: planStats.done,
        mustDone: planStats.mustDone,
        mustTotal: planStats.mustTotal,
        openMusts: planStats.openMusts.map((item) => item.title),
      }
    : { total: 0, done: 0, mustDone: 0, mustTotal: 0, openMusts: [] };

  return [
    "You are sending a short hourly accountability ping in Telegram.",
    buildToneInstruction(tone),
    "Return only 1 to 3 short lines.",
    "No fluff. No essay. No generic motivation.",
    "Mention one concrete observation and one direct question or instruction.",
    "If logs are missing, ask what the user is doing right now so it can be logged.",
    "",
    `Theme: ${theme}`,
    `Date: ${snapshot.date}`,
    `Recent themes to avoid repeating: ${snapshot.recentThemes.join(", ") || "none"}`,
    `Plan snapshot: ${JSON.stringify(planSummary)}`,
    `Work snapshot: ${JSON.stringify({
      totalMinutes: snapshot.work.totalMinutes,
      totalsByCategory: snapshot.work.totalsByCategory,
    })}`,
    `Life snapshot: ${JSON.stringify({
      totalMinutes: snapshot.life.totalMinutes,
      focusedMinutes: snapshot.life.focusedMinutes,
      breakMinutes: snapshot.life.breakMinutes,
      entertainmentMinutes: snapshot.life.entertainmentMinutes,
      wakeUpTime: snapshot.life.wakeUpTime,
      timelineCount: snapshot.life.timeline.length,
    })}`,
    `Active reminders: ${JSON.stringify(snapshot.reminders.map((reminder) => ({
      text: reminder.text,
      dueAtIso: reminder.dueAtIso,
    })))} `,
    `Coach profile: ${JSON.stringify({
      toneMode: snapshot.profile.toneMode,
      driftScore: snapshot.profile.driftScore,
      loggingReliability: snapshot.profile.loggingReliability,
    })}`,
  ].join("\n");
}

async function generateHourlyMessage(
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
  theme: HeartbeatTheme,
  tone: CoachToneMode,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "user", content: buildHourlyPrompt(snapshot, theme, tone) },
  ];

  const response = await chat(
    "You are a concise accountability coach.",
    messages,
    [],
    { maxTokens: 140 },
  );

  return response.choices[0]?.message?.content?.trim() || "What are you doing right now?";
}

export async function sendMorningCheckIn(chatId: number): Promise<void> {
  try {
    const text = buildMorningMessage(chatId);
    await sendHeartbeatMessage(chatId, text);
    recordHeartbeatEvent(chatId, "plan", "normal", text, "morning_checkin");
    console.log(`💓 Morning planning prompt sent to chat ${chatId}`);
  } catch (err) {
    console.error("❌ Morning heartbeat failed:", err);
  }
}

export async function sendHourlyCheckIn(chatId: number): Promise<void> {
  try {
    const snapshot = await buildHourlySnapshot(chatId);
    const lowMoodSignal =
      snapshot.work.totalMinutes === 0 &&
      snapshot.life.entertainmentMinutes > snapshot.life.focusedMinutes &&
      snapshot.profile.driftScore > 0.8;
    const tone = chooseHeartbeatTone(chatId, lowMoodSignal);
    const { theme, reason } = chooseTheme(snapshot);
    const text = await generateHourlyMessage(snapshot, theme, tone);
    await sendHeartbeatMessage(chatId, text);
    recordHeartbeatEvent(chatId, theme, tone, text, reason);
    console.log(`💓 Hourly heartbeat sent to chat ${chatId} [${theme}/${tone}]`);
  } catch (err) {
    console.error("❌ Hourly heartbeat failed:", err);
  }
}

export async function sendEveningReview(chatId: number): Promise<void> {
  try {
    const text = await buildEveningMessage(chatId);
    await sendHeartbeatMessage(chatId, text);
    recordHeartbeatEvent(chatId, "reflection", "normal", text, "evening_review");
    console.log(`💓 Evening review sent to chat ${chatId}`);
  } catch (err) {
    console.error("❌ Evening heartbeat failed:", err);
  }
}

export async function generateAndStoreDailySummary(chatId: number, date = getYesterdayDate()): Promise<void> {
  try {
    const metrics = await collectDailySummaryMetrics(chatId, date);
    const summaryText = await generateDailySummaryText(chatId, date, metrics);
    storeDailySummary(chatId, date, summaryText, metrics);
    console.log(`🧠 Daily summary stored for ${chatId} on ${date}`);
  } catch (err) {
    console.error("❌ Daily summary generation failed:", err);
  }
}

let morningTask: cron.ScheduledTask | null = null;
let hourlyTask: cron.ScheduledTask | null = null;
let eveningTask: cron.ScheduledTask | null = null;
let dailySummaryTask: cron.ScheduledTask | null = null;

export function startHeartbeat(): void {
  const chatId = config.allowedUserIds[0];

  if (!chatId) {
    console.warn("⚠️  No user IDs configured — heartbeat disabled.");
    return;
  }

  const profile = getCoachProfile(chatId);
  const startHour = profile.activeStartHour;
  const endHour = profile.activeEndHour;

  morningTask = cron.schedule("0 8 * * *", async () => {
    console.log("💓 Heartbeat firing — Morning Plan");
    await sendMorningCheckIn(chatId);
  }, { timezone: "Asia/Kolkata" });

  hourlyTask = cron.schedule(`0 ${startHour + 1}-${endHour} * * *`, async () => {
    console.log("💓 Heartbeat firing — Hourly Check-in");
    await sendHourlyCheckIn(chatId);
  }, { timezone: "Asia/Kolkata" });

  eveningTask = cron.schedule("0 20 * * *", async () => {
    console.log("💓 Heartbeat firing — Evening Review");
    await sendEveningReview(chatId);
  }, { timezone: "Asia/Kolkata" });

  dailySummaryTask = cron.schedule("0 0 * * *", async () => {
    console.log("🧠 Daily summary generation firing");
    await generateAndStoreDailySummary(chatId);
  }, { timezone: "Asia/Kolkata" });

  console.log(`💓 Heartbeats scheduled: morning 8:00, hourly ${startHour + 1}:00-${endHour}:00, evening 20:00, summary 00:00 IST`);
}

export function stopHeartbeat(): void {
  if (morningTask) morningTask.stop();
  if (hourlyTask) hourlyTask.stop();
  if (eveningTask) eveningTask.stop();
  if (dailySummaryTask) dailySummaryTask.stop();
  morningTask = null;
  hourlyTask = null;
  eveningTask = null;
  dailySummaryTask = null;
}

export async function sendTestCheckIn(): Promise<void> {
  const chatId = config.allowedUserIds[0];
  if (!chatId) return;
  await sendHourlyCheckIn(chatId);
}

export function getCurrentSummaryTargetDate(): string {
  return getTodayPlanDate();
}
