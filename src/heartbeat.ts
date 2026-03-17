import cron from "node-cron";
import { chat, type ChatCompletionMessageParam } from "./llm.js";
import { config } from "./config.js";
import { sendTelegramText } from "./bot.js";
import { getHistory } from "./agent.js";
import {
  buildHourlySnapshot,
  chooseHeartbeatToneFromProfile,
  collectDailySummaryMetrics,
  generateDailySummaryText,
  getCoachProfile,
  markHeartbeatContextAsked,
  getRecentHeartbeatThemes,
  recordHeartbeatEvent,
  storeDailySummary,
  type CoachToneMode,
  type HeartbeatContextSource,
  type HeartbeatTheme,
  upsertHeartbeatContext,
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
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "00");

  let parsedHour = hour;
  if (parsedHour === 24) parsedHour = 0;

  const period = parsedHour >= 12 ? "PM" : "AM";
  let h12 = parsedHour % 12;
  if (h12 === 0) h12 = 12;

  const timeStr = `${String(h12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;

  return {
    date: `${year}-${month}-${day}`,
    time: timeStr,
    hour: parsedHour,
  };
}

function getYesterdayDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return getISTDateTime(date).date;
}

function formatRecentHistory(chatId: number): string {
  const history = getHistory(chatId);
  if (!history || history.length === 0) return "No recent context.";
  const recent = history.slice(-4);
  return recent
    .map((msg) => `${msg.role}: ${typeof msg.content === "string" ? msg.content.substring(0, 100) : "..."}`)
    .join("\n");
}

export interface HeartbeatContextCandidate {
  contextKey: string;
  subject: string;
  sourceType: HeartbeatContextSource;
  priority: number;
  askCount: number;
  theme: HeartbeatTheme;
  reason: string;
  observation: string;
}

function normalizeContextKey(subject: string): string {
  return subject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getCandidateAskCount(
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
  contextKey: string,
): number {
  const existing = snapshot.contexts.find((context) => context.contextKey === contextKey);
  return existing?.askCount ?? 0;
}

function isTodayTimestamp(snapshotDate: string, value?: string | null): boolean {
  return Boolean(value && value.startsWith(snapshotDate));
}

export function buildContextCandidates(
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
): HeartbeatContextCandidate[] {
  const candidates: HeartbeatContextCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    sourceType: HeartbeatContextSource,
    subject: string,
    priority: number,
    theme: HeartbeatTheme,
    reason: string,
    observation: string,
  ) => {
    const contextKey = normalizeContextKey(subject);
    if (!contextKey || seen.has(`${sourceType}:${contextKey}`)) return;
    seen.add(`${sourceType}:${contextKey}`);
    candidates.push({
      contextKey,
      subject: subject.trim(),
      sourceType,
      priority,
      askCount: getCandidateAskCount(snapshot, contextKey),
      theme,
      reason,
      observation,
    });
  };

  if (snapshot.life.openSession?.activity) {
    pushCandidate(
      "life_log",
      snapshot.life.openSession.activity,
      100,
      "focus",
      "open_life_session",
      `You have ${snapshot.life.openSession.activity} open since ${snapshot.life.openSession.startTime}.`,
    );
  }

  for (const context of snapshot.contexts.filter((item) => item.sourceType === "conversation")) {
    const priority = isTodayTimestamp(snapshot.date, context.updatedAt) ? 90 : 55;
    pushCandidate(
      context.sourceType,
      context.subject,
      priority,
      "focus",
      isTodayTimestamp(snapshot.date, context.updatedAt) ? "today_conversation_context" : "recent_conversation_context",
      `Earlier you were on ${context.subject}.`,
    );
  }

  const inProgressItems = snapshot.plan?.items.filter((item) => item.status === "in_progress") ?? [];
  for (const item of inProgressItems) {
    pushCandidate(
      "plan",
      item.title,
      85,
      "focus",
      "plan_in_progress",
      `${item.title} is marked in progress on today's plan.`,
    );
  }

  const openMusts = (snapshot.plan?.items ?? []).filter(
    (item) => item.priority === "must" && item.status !== "done" && item.status !== "skipped",
  );
  for (const item of openMusts.slice(0, 2)) {
    pushCandidate(
      "plan",
      item.title,
      75,
      "plan",
      "open_must_do",
      `${item.title} is still open on today's must-do list.`,
    );
  }

  const lastWorkLog = [...snapshot.work.logs]
    .reverse()
    .find((log) => log.workTitle || log.tag || log.category);
  if (lastWorkLog) {
    const workSubject = lastWorkLog.workTitle || lastWorkLog.tag || lastWorkLog.category;
    pushCandidate(
      "work_log",
      workSubject,
      65,
      "work_log",
      "latest_work_log",
      `Your last logged work was ${workSubject}${lastWorkLog.time ? ` at ${lastWorkLog.time}` : ""}.`,
    );
  }

  return candidates.sort((a, b) => b.priority - a.priority || a.askCount - b.askCount);
}

export function chooseContextCandidate(
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
): HeartbeatContextCandidate | null {
  const candidates = buildContextCandidates(snapshot);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const [best, second] = candidates;
  if (best.askCount > 0 && second.priority >= best.priority - 8) {
    return second;
  }
  return best;
}

function buildMorningMessage(chatId: number): string {
  const stats = getUserStats(chatId);
  const plan = getDailyPlan(chatId);

  if (!plan || plan.items.length === 0) {
    return [
      "Good morning.",
      `Level ${stats.level} | ${stats.totalExp} EXP`,
      "No plan is locked in yet.",
      "Reply with your top 3 must-dos and constraints. If you are stuck or don't know what to do, just tell me and we can brainstorm together.",
    ].join("\n");
  }

  const musts = plan.items.filter((item) => item.priority === "must").slice(0, 3);

  return [
    "Morning commitment.",
    `Level ${stats.level} | ${stats.totalExp} EXP`,
    musts.length > 0
      ? `Must-dos: ${musts.map((item) => `${item.title}${item.timeBlock ? ` @ ${item.timeBlock}` : ""}`).join(" | ")}`
      : "No must-do items yet. Tighten the plan.",
    "Start with the hardest thing first. I'm here if you get stuck.",
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

function buildFallbackHourlyPrompt(
  chatId: number,
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
    "Only ask a generic 'What are you doing right now?' if there is no concrete task, plan item, or recent context.",
    "",
    `Theme: ${theme}`,
    `Date: ${snapshot.date}`,
    `Recent themes to avoid repeating: ${snapshot.recentThemes.join(", ") || "none"}`,
    `Recent Conversation Context:\n${formatRecentHistory(chatId)}`,
    `Active conversation contexts: ${JSON.stringify(snapshot.contexts.map((context) => ({
      subject: context.subject,
      updatedAt: context.updatedAt,
      askCount: context.askCount,
    })))} `,
    `Plan snapshot: ${JSON.stringify(planSummary)}`,
    `Work snapshot: ${JSON.stringify({
      totalMinutes: snapshot.work.totalMinutes,
      totalsByCategory: snapshot.work.totalsByCategory,
      lastLog: snapshot.work.logs.length > 0 ? snapshot.work.logs[snapshot.work.logs.length - 1] : null,
    })}`,
    `Life snapshot: ${JSON.stringify({
      totalMinutes: snapshot.life.totalMinutes,
      focusedMinutes: snapshot.life.focusedMinutes,
      breakMinutes: snapshot.life.breakMinutes,
      entertainmentMinutes: snapshot.life.entertainmentMinutes,
      wakeUpTime: snapshot.life.wakeUpTime,
      timelineCount: snapshot.life.timeline.length,
      openSession: snapshot.life.openSession ? { activity: snapshot.life.openSession.activity, startTime: snapshot.life.openSession.startTime } : null,
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

function buildQuestionForStage(
  stage: number,
  tone: CoachToneMode,
  subject: string,
): string {
  const quotedSubject = `"${subject}"`;

  if (stage <= 0) {
    if (tone === "supportive") return `How is ${quotedSubject} going?`;
    return `How is ${quotedSubject} going?`;
  }

  if (stage === 1) {
    if (tone === "supportive") return `Did you get through ${quotedSubject}?`;
    if (tone === "strict") return `Did you finish ${quotedSubject}?`;
    return `Did you finish ${quotedSubject}?`;
  }

  if (tone === "supportive") return `What is still blocking ${quotedSubject}?`;
  if (tone === "strict") return `What is still blocking ${quotedSubject}?`;
  return `What's still blocking ${quotedSubject}?`;
}

export function buildContextDrivenMessage(
  candidate: HeartbeatContextCandidate,
  tone: CoachToneMode,
): string {
  const observation = candidate.observation;
  const question = buildQuestionForStage(candidate.askCount, tone, candidate.subject);

  if (tone === "supportive") {
    return `${observation}\n${question}`;
  }

  if (tone === "strict" && candidate.askCount >= 2) {
    return `${observation}\n${question} Answer plainly.`;
  }

  if (tone === "warm_firm" && candidate.askCount >= 1) {
    return `${observation}\n${question} Keep it concrete.`;
  }

  return `${observation}\n${question}`;
}

async function generateFallbackHourlyMessage(
  chatId: number,
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
  theme: HeartbeatTheme,
  tone: CoachToneMode,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "user", content: buildFallbackHourlyPrompt(chatId, snapshot, theme, tone) },
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
    getHistory(chatId).push({ role: "assistant", content: text });
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
    const tone = chooseHeartbeatToneFromProfile(snapshot.profile, lowMoodSignal);
    const selectedCandidate = chooseContextCandidate(snapshot);
    const fallbackTheme = chooseTheme(snapshot);
    const theme = selectedCandidate?.theme ?? fallbackTheme.theme;
    const reason = selectedCandidate?.reason ?? fallbackTheme.reason;
    const text = selectedCandidate
      ? buildContextDrivenMessage(selectedCandidate, tone)
      : await generateFallbackHourlyMessage(chatId, snapshot, theme, tone);

    if (selectedCandidate) {
      upsertHeartbeatContext(
        chatId,
        selectedCandidate.sourceType,
        selectedCandidate.subject,
        "active",
        { reason: selectedCandidate.reason, observation: selectedCandidate.observation },
      );
      markHeartbeatContextAsked(chatId, selectedCandidate.contextKey);
    }

    await sendHeartbeatMessage(chatId, text);
    getHistory(chatId).push({ role: "assistant", content: text });
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
    getHistory(chatId).push({ role: "assistant", content: text });
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
