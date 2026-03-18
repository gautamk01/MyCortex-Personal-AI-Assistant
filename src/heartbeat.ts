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
  lastSeenAt: string;
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
    lastSeenAt: string,
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
      lastSeenAt,
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
      snapshot.date + "T" + snapshot.life.openSession.startTime + ":00"
    );
  }

  for (const context of snapshot.contexts.filter((item) => item.sourceType === "conversation")) {
    pushCandidate(
      context.sourceType,
      context.subject,
      90,
      "focus",
      "recent_conversation_context",
      `You were recently working on ${context.subject}.`,
      context.firstSeenAt || context.createdAt,
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
      snapshot.date + "T00:00:00"
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
      snapshot.date + "T00:00:00"
    );
  }

  const lastWorkLog = [...snapshot.work.logs]
    .reverse()
    .find((log) => log.description || log.category);
  if (lastWorkLog) {
    const workSubject = lastWorkLog.description || lastWorkLog.category;
    pushCandidate(
      "work_log",
      workSubject,
      65,
      "work_log",
      "latest_work_log",
      `Your last logged work was ${workSubject}.`,
      snapshot.date + "T00:00:00"
    );
  }

  return candidates.sort((a, b) => {
    const timeCompare = b.lastSeenAt.localeCompare(a.lastSeenAt);
    if (timeCompare !== 0) return timeCompare;
    return b.priority - a.priority;
  });
}

export function chooseContextCandidate(
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
): HeartbeatContextCandidate | null {
  const candidates = buildContextCandidates(snapshot);
  if (candidates.length === 0) return null;
  // Always pick the most recent context (sorted by firstSeenAt DESC)
  return candidates[0];
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

export function buildHourlyPrompt(
  chatId: number,
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
  theme: HeartbeatTheme,
  tone: CoachToneMode,
  inactivityHours: number,
  selectedCandidate: HeartbeatContextCandidate | null,
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
    "You are texting your close friend on Telegram. Keep it super casual and natural — like a real person checking in, not a bot or coach.",
    "Write exactly 1 short message. Use natural language, slang is okay, emoji sparingly. No bullet points, no lists, no essays.",
    buildToneInstruction(tone),
    inactivityHours >= 2
      ? `They haven't texted you in ${Math.floor(inactivityHours)} hours. Casually ask what happened — like a friend going "dude where'd you go?" or "you alive?". Mention you haven't heard from them in a while.`
      : selectedCandidate
      ? `They were working on "${selectedCandidate.subject}". Casually ask how it went — like "so did you end up doing [thing]?" or "how'd [thing] go?". Don't be robotic about it.`
      : "Just casually ask what they're up to right now.",
    "",
    `Time: ${getISTDateTime().time}`,
    `Recent chat:\n${formatRecentHistory(chatId)}`,
    planSummary.openMusts.length > 0
      ? `Open must-dos: ${planSummary.openMusts.join(", ")}`
      : "",
  ].filter(Boolean).join("\n");
}


export async function generateHourlyMessage(
  chatId: number,
  snapshot: Awaited<ReturnType<typeof buildHourlySnapshot>>,
  theme: HeartbeatTheme,
  tone: CoachToneMode,
  inactivityHours: number = 0,
  selectedCandidate: HeartbeatContextCandidate | null = null,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "user", content: buildHourlyPrompt(chatId, snapshot, theme, tone, inactivityHours, selectedCandidate) },
  ];

  const response = await chat(
    "You are a close friend who texts casually. You care about your friend's progress but you talk like a real person, not a coach or assistant.",
    messages,
    [],
    { maxTokens: 800 },
  );

  return response.choices[0]?.message?.content?.trim() || "Hey, just checking in — how's it going? 🙂";
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

    // Calculate Inactivity
    let inactivityHours = 0;
    const now = new Date();
    const currentHour = now.getHours();
    
    // Skip inactivity check during sleep hours (12 AM - 7 AM)
    if (snapshot.profile.lastActiveAt && currentHour >= 7 || currentHour < 0 /* impossible but safe */) {
      const lastActive = new Date(snapshot.profile.lastActiveAt + "Z"); // UTC
      const diffMs = now.getTime() - lastActive.getTime();
      inactivityHours = diffMs / (1000 * 60 * 60);
      
      // Handle the sleep overlap: If last message was before 7AM today, don't ping them for inactivity just yet
      const startOfActiveDay = new Date(now);
      startOfActiveDay.setHours(7, 0, 0, 0);
      if (lastActive.getTime() < startOfActiveDay.getTime()) {
        inactivityHours = 0;
      }
    }

    // Determine candidates and fallback
    let selectedCandidate = chooseContextCandidate(snapshot);
    const fallbackTheme = chooseTheme(snapshot);
    const theme = selectedCandidate?.theme ?? fallbackTheme.theme;
    const reason = selectedCandidate?.reason ?? fallbackTheme.reason;

    // If they have been inactive for > 2 hours, FORCE the fallback LLM ping so it challenges them
    if (inactivityHours >= 2) {
      selectedCandidate = null;
    }

    const text = await generateHourlyMessage(chatId, snapshot, theme, tone, inactivityHours, selectedCandidate);

    if (selectedCandidate) {
      upsertHeartbeatContext(
        chatId,
        selectedCandidate.sourceType,
        selectedCandidate.subject,
        "active",
        { reason: selectedCandidate.reason, observation: selectedCandidate.observation },
        false, // Do NOT artificially update lastSeenAt
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
