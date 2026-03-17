import { chat, type ChatCompletionMessageParam } from "./llm.js";
import { getDailyPlan, getDailyPlanStats, type DailyPlan } from "./daily-plan.js";
import { summarizeLifeLogs, summarizeWorkLogs } from "./sheets.js";
import { getDb, getUserStats } from "./memory/sqlite.js";

export type CoachToneMode = "normal" | "warm_firm" | "supportive" | "strict";
export type HeartbeatTheme =
  | "plan"
  | "todoist"
  | "work_log"
  | "life_log"
  | "focus"
  | "break"
  | "meal"
  | "reminder"
  | "reflection"
  | "drift";

export interface CoachProfile {
  chatId: number;
  toneMode: CoachToneMode;
  encouragementStyle: string;
  pressureStyle: string;
  driftScore: number;
  loggingReliability: number;
  activeStartHour: number;
  activeEndHour: number;
}

export interface DailySummaryRecord {
  id: number;
  chatId: number;
  summaryDate: string;
  summaryText: string;
  metricsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderSnapshot {
  id: string;
  chatId: number;
  text: string;
  dueAtIso: string;
  createdAtIso: string;
  notes: string;
  status: "scheduled" | "done" | "cancelled";
}

export type HeartbeatContextSource =
  | "conversation"
  | "plan"
  | "work_log"
  | "life_log"
  | "summary";

export type HeartbeatContextStatus = "active" | "done" | "stale";

export interface HeartbeatContextRecord {
  id: number;
  chatId: number;
  contextKey: string;
  sourceType: HeartbeatContextSource;
  subject: string;
  status: HeartbeatContextStatus;
  evidenceJson: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAskedAt: string;
  askCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailySummaryMetrics {
  plan: {
    exists: boolean;
    total: number;
    done: number;
    mustDone: number;
    mustTotal: number;
    skipped: number;
    openMustTitles: string[];
  };
  work: {
    totalMinutes: number;
    totalExp: number;
    totalsByCategory: Record<string, number>;
  };
  life: {
    totalMinutes: number;
    focusedMinutes: number;
    breakMinutes: number;
    entertainmentMinutes: number;
    wakeUpTime: string | null;
    timelineCount: number;
  };
  reminders: {
    created: number;
    fired: number;
    snoozed: number;
    done: number;
    cancelled: number;
  };
  heartbeats: {
    count: number;
    respondedCount: number;
    themes: string[];
  };
  exp: {
    totalDelta: number;
  };
}

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

function getYesterdayDate(reference = new Date()): string {
  const date = new Date(reference);
  date.setUTCDate(date.getUTCDate() - 1);
  return getISTDateTime(date).date;
}

function getStartOfDayUtc(date: string): string {
  return `${date}T00:00:00+05:30`;
}

function getEndOfDayUtc(date: string): string {
  return `${date}T23:59:59+05:30`;
}

export function getCoachProfile(chatId: number): CoachProfile {
  let profile = getDb()
    .prepare(`
      SELECT chatId, toneMode, encouragementStyle, pressureStyle, driftScore,
             loggingReliability, activeStartHour, activeEndHour
      FROM coach_profiles
      WHERE chatId = ?
    `)
    .get(chatId) as CoachProfile | undefined;

  if (!profile) {
    getDb()
      .prepare("INSERT INTO coach_profiles (chatId) VALUES (?)")
      .run(chatId);
    profile = {
      chatId,
      toneMode: "normal",
      encouragementStyle: "warm_firm",
      pressureStyle: "firm",
      driftScore: 0,
      loggingReliability: 0.5,
      activeStartHour: 8,
      activeEndHour: 22,
    };
  }

  return profile;
}

export function getCoachProfileContext(chatId: number): string {
  const profile = getCoachProfile(chatId);

  return [
    "\n## Coach Profile",
    `- tone_mode: ${profile.toneMode}`,
    `- encouragement_style: ${profile.encouragementStyle}`,
    `- pressure_style: ${profile.pressureStyle}`,
    `- drift_score: ${profile.driftScore.toFixed(2)}`,
    `- logging_reliability: ${profile.loggingReliability.toFixed(2)}`,
    `- active_hours: ${profile.activeStartHour}:00-${profile.activeEndHour}:00 IST`,
  ].join("\n");
}

export function recordHeartbeatEvent(
  chatId: number,
  theme: HeartbeatTheme,
  toneMode: CoachToneMode,
  message: string,
  reason = "",
): void {
  const now = getISTDateTime();
  getDb()
    .prepare(`
      INSERT INTO heartbeat_events (
        chatId, eventDate, eventTime, theme, toneMode, message, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(chatId, now.date, now.time, theme, toneMode, message, reason);
}

export function getRecentHeartbeatThemes(chatId: number, limit = 3): string[] {
  const rows = getDb()
    .prepare(`
      SELECT theme
      FROM heartbeat_events
      WHERE chatId = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(chatId, limit) as Array<{ theme: string }>;

  return rows.map((row) => row.theme);
}

export function markRecentHeartbeatResponded(chatId: number): void {
  const now = getISTDateTime();
  getDb()
    .prepare(`
      UPDATE heartbeat_events
      SET userResponded = 1
      WHERE id = (
        SELECT id
        FROM heartbeat_events
        WHERE chatId = ? AND eventDate = ? AND userResponded = 0
        ORDER BY id DESC
        LIMIT 1
      )
    `)
    .run(chatId, now.date);
}

export function recordReminderEvent(
  chatId: number,
  reminderId: string,
  eventType: "created" | "fired" | "snoozed" | "done" | "cancelled",
  dueAtIso: string,
  details: Record<string, unknown> = {},
): void {
  getDb()
    .prepare(`
      INSERT INTO reminder_events (chatId, reminderId, eventType, dueAtIso, detailsJson)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(chatId, reminderId, eventType, dueAtIso, JSON.stringify(details));
}

function summarizeReminderActivity(chatId: number, date: string): DailySummaryMetrics["reminders"] {
  const rows = getDb()
    .prepare(`
      SELECT eventType, COUNT(*) as count
      FROM reminder_events
      WHERE chatId = ?
        AND createdAt >= datetime(?)
        AND createdAt <= datetime(?)
      GROUP BY eventType
    `)
    .all(chatId, getStartOfDayUtc(date), getEndOfDayUtc(date)) as Array<{ eventType: string; count: number }>;

  const summary: DailySummaryMetrics["reminders"] = {
    created: 0,
    fired: 0,
    snoozed: 0,
    done: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    if (row.eventType in summary) {
      summary[row.eventType as keyof DailySummaryMetrics["reminders"]] = row.count;
    }
  }

  return summary;
}

function summarizeHeartbeatActivity(chatId: number, date: string): DailySummaryMetrics["heartbeats"] {
  const rows = getDb()
    .prepare(`
      SELECT theme, userResponded
      FROM heartbeat_events
      WHERE chatId = ? AND eventDate = ?
      ORDER BY id ASC
    `)
    .all(chatId, date) as Array<{ theme: string; userResponded: number }>;

  return {
    count: rows.length,
    respondedCount: rows.filter((row) => row.userResponded === 1).length,
    themes: Array.from(new Set(rows.map((row) => row.theme))),
  };
}

function summarizeExpDelta(chatId: number, date: string): number {
  const row = getDb()
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM exp_log
      WHERE chatId = ?
        AND createdAt >= datetime(?)
        AND createdAt <= datetime(?)
    `)
    .get(chatId, getStartOfDayUtc(date), getEndOfDayUtc(date)) as { total: number } | undefined;

  return Number(row?.total ?? 0);
}

export async function collectDailySummaryMetrics(
  chatId: number,
  date: string,
): Promise<DailySummaryMetrics> {
  const plan = getDailyPlan(chatId, date);
  const [work, life] = await Promise.all([
    summarizeWorkLogs(date, date),
    summarizeLifeLogs(date, date),
  ]);

  let planMetrics: DailySummaryMetrics["plan"] = {
    exists: false,
    total: 0,
    done: 0,
    mustDone: 0,
    mustTotal: 0,
    skipped: 0,
    openMustTitles: [],
  };

  if (plan) {
    const stats = getDailyPlanStats(plan);
    planMetrics = {
      exists: true,
      total: stats.total,
      done: stats.done,
      mustDone: stats.mustDone,
      mustTotal: stats.mustTotal,
      skipped: stats.skipped,
      openMustTitles: stats.openMusts.map((item) => item.title),
    };
  }

  return {
    plan: planMetrics,
    work: {
      totalMinutes: work.totalMinutes,
      totalExp: work.totalExp,
      totalsByCategory: work.totalsByCategory,
    },
    life: {
      totalMinutes: life.totalMinutes,
      focusedMinutes: life.focusedMinutes,
      breakMinutes: life.breakMinutes,
      entertainmentMinutes: life.entertainmentMinutes,
      wakeUpTime: life.wakeUpTime,
      timelineCount: life.timeline.length,
    },
    reminders: summarizeReminderActivity(chatId, date),
    heartbeats: summarizeHeartbeatActivity(chatId, date),
    exp: {
      totalDelta: summarizeExpDelta(chatId, date),
    },
  };
}

function buildDailySummaryPrompt(
  chatId: number,
  date: string,
  metrics: DailySummaryMetrics,
): string {
  const stats = getUserStats(chatId);
  return [
    "You are writing a short daily summary for long-term memory.",
    "Keep it truthful, compact, and specific.",
    "Use 4 to 7 short sentences max.",
    "Mention wins, misses, drift, and what actually happened.",
    "Do not use filler or motivational fluff.",
    "",
    `Date: ${date}`,
    `Level: ${stats.level}`,
    `Total EXP: ${stats.totalExp}`,
    `Metrics: ${JSON.stringify(metrics)}`,
  ].join("\n");
}

export async function generateDailySummaryText(
  chatId: number,
  date: string,
  metrics: DailySummaryMetrics,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "user", content: buildDailySummaryPrompt(chatId, date, metrics) },
  ];

  const response = await chat(
    "You are a concise accountability summarizer.",
    messages,
    [],
    { maxTokens: 220 },
  );

  return response.choices[0]?.message?.content?.trim() || `Summary unavailable for ${date}.`;
}

export function storeDailySummary(
  chatId: number,
  date: string,
  summaryText: string,
  metrics: DailySummaryMetrics,
): void {
  getDb()
    .prepare(`
      INSERT INTO daily_summaries (chatId, summaryDate, summaryText, metricsJson, updatedAt)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(chatId, summaryDate) DO UPDATE SET
        summaryText = excluded.summaryText,
        metricsJson = excluded.metricsJson,
        updatedAt = datetime('now')
    `)
    .run(chatId, date, summaryText, JSON.stringify(metrics));

  applySummaryToCoachProfile(chatId, metrics);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applySummaryToCoachProfile(chatId: number, metrics: DailySummaryMetrics): void {
  const profile = getCoachProfile(chatId);
  let driftScore = profile.driftScore;
  let loggingReliability = profile.loggingReliability;
  let toneMode: CoachToneMode = profile.toneMode;

  if (metrics.plan.mustTotal > 0 && metrics.plan.mustDone < metrics.plan.mustTotal) {
    driftScore += 0.3;
  } else {
    driftScore -= 0.2;
  }

  if (metrics.work.totalMinutes > 0 || metrics.life.timelineCount > 0) {
    loggingReliability += 0.1;
  } else {
    loggingReliability -= 0.15;
  }

  if (metrics.work.totalMinutes >= 120 || metrics.plan.mustDone === metrics.plan.mustTotal) {
    toneMode = "normal";
  } else if (metrics.exp.totalDelta < 0 || metrics.life.entertainmentMinutes > metrics.life.focusedMinutes) {
    toneMode = "strict";
  } else if (metrics.plan.exists && metrics.plan.done > 0) {
    toneMode = "warm_firm";
  }

  driftScore = clamp(driftScore, -1, 3);
  loggingReliability = clamp(loggingReliability, 0, 1);

  getDb()
    .prepare(`
      UPDATE coach_profiles
      SET toneMode = ?,
          driftScore = ?,
          loggingReliability = ?,
          updatedAt = datetime('now')
      WHERE chatId = ?
    `)
    .run(toneMode, driftScore, loggingReliability, chatId);
}

export function getDailySummary(chatId: number, date: string): DailySummaryRecord | null {
  const row = getDb()
    .prepare(`
      SELECT id, chatId, summaryDate, summaryText, metricsJson, createdAt, updatedAt
      FROM daily_summaries
      WHERE chatId = ? AND summaryDate = ?
    `)
    .get(chatId, date) as DailySummaryRecord | undefined;

  return row ?? null;
}

export function listDailySummaries(chatId: number, limit = 7): DailySummaryRecord[] {
  return getDb()
    .prepare(`
      SELECT id, chatId, summaryDate, summaryText, metricsJson, createdAt, updatedAt
      FROM daily_summaries
      WHERE chatId = ?
      ORDER BY summaryDate DESC
      LIMIT ?
    `)
    .all(chatId, limit) as DailySummaryRecord[];
}

export function getRecentDailySummaryContext(chatId: number, limit = 3): string {
  const rows = listDailySummaries(chatId, limit);
  if (rows.length === 0) return "";

  const lines = rows.map((row) => `- ${row.summaryDate}: ${row.summaryText}`);
  return `\n## Recent Daily Summaries\n${lines.join("\n")}`;
}

export function chooseHeartbeatToneFromProfile(
  profile: CoachProfile,
  lowMoodSignal = false,
): CoachToneMode {
  if (lowMoodSignal) return "warm_firm";
  if (profile.driftScore >= 1.2) return "strict";
  if (profile.loggingReliability < 0.35) return "warm_firm";
  return profile.toneMode;
}

export function chooseHeartbeatTone(chatId: number, lowMoodSignal = false): CoachToneMode {
  return chooseHeartbeatToneFromProfile(getCoachProfile(chatId), lowMoodSignal);
}

function normalizeHeartbeatContextKey(subject: string): string {
  return subject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getHeartbeatContextCutoff(days = 2): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString().slice(0, 19).replace("T", " ");
}

export function cleanupOldHeartbeatContexts(days = 2): number {
  const result = getDb()
    .prepare(`
      DELETE FROM heartbeat_contexts
      WHERE updatedAt < ?
    `)
    .run(getHeartbeatContextCutoff(days));

  return result.changes;
}

export function upsertHeartbeatContext(
  chatId: number,
  sourceType: HeartbeatContextSource,
  subject: string,
  status: HeartbeatContextStatus = "active",
  evidence: Record<string, unknown> = {},
): void {
  const trimmedSubject = subject.trim();
  if (!trimmedSubject) return;

  const contextKey = normalizeHeartbeatContextKey(trimmedSubject);
  if (!contextKey) return;

  const existing = getDb()
    .prepare(`
      SELECT id, askCount, firstSeenAt
      FROM heartbeat_contexts
      WHERE chatId = ? AND contextKey = ? AND sourceType = ?
    `)
    .get(chatId, contextKey, sourceType) as
    | { id: number; askCount: number; firstSeenAt: string }
    | undefined;

  if (existing) {
    getDb()
      .prepare(`
        UPDATE heartbeat_contexts
        SET subject = ?,
            status = ?,
            evidenceJson = ?,
            lastSeenAt = datetime('now'),
            updatedAt = datetime('now')
        WHERE id = ?
      `)
      .run(trimmedSubject, status, JSON.stringify(evidence), existing.id);
    return;
  }

  getDb()
    .prepare(`
      INSERT INTO heartbeat_contexts (
        chatId, contextKey, sourceType, subject, status, evidenceJson
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(chatId, contextKey, sourceType, trimmedSubject, status, JSON.stringify(evidence));
}

export function setHeartbeatContextStatus(
  chatId: number,
  subject: string,
  status: HeartbeatContextStatus,
): void {
  const contextKey = normalizeHeartbeatContextKey(subject);
  if (!contextKey) return;

  getDb()
    .prepare(`
      UPDATE heartbeat_contexts
      SET status = ?,
          updatedAt = datetime('now')
      WHERE chatId = ? AND contextKey = ?
    `)
    .run(status, chatId, contextKey);
}

export function listActiveHeartbeatContexts(chatId: number, limit = 5): HeartbeatContextRecord[] {
  return getDb()
    .prepare(`
      SELECT id, chatId, contextKey, sourceType, subject, status, evidenceJson,
             firstSeenAt, lastSeenAt, lastAskedAt, askCount, createdAt, updatedAt
      FROM heartbeat_contexts
      WHERE chatId = ?
        AND status = 'active'
        AND updatedAt >= ?
      ORDER BY
        CASE sourceType
          WHEN 'conversation' THEN 1
          WHEN 'life_log' THEN 2
          WHEN 'plan' THEN 3
          WHEN 'work_log' THEN 4
          ELSE 5
        END,
        updatedAt DESC
      LIMIT ?
    `)
    .all(chatId, getHeartbeatContextCutoff(), limit) as HeartbeatContextRecord[];
}

export function markHeartbeatContextAsked(chatId: number, contextKey: string): void {
  getDb()
    .prepare(`
      UPDATE heartbeat_contexts
      SET lastAskedAt = datetime('now'),
          askCount = askCount + 1,
          updatedAt = datetime('now')
      WHERE chatId = ? AND contextKey = ?
    `)
    .run(chatId, contextKey);
}

export async function buildHourlySnapshot(chatId: number): Promise<{
  date: string;
  profile: CoachProfile;
  plan: DailyPlan | null;
  work: Awaited<ReturnType<typeof summarizeWorkLogs>>;
  life: Awaited<ReturnType<typeof summarizeLifeLogs>>;
  reminders: ReminderSnapshot[];
  recentThemes: string[];
  contexts: HeartbeatContextRecord[];
}> {
  const now = getISTDateTime();
  const { listReminders } = await import("./reminders.js");
  const profile = getCoachProfile(chatId);
  const [work, life] = await Promise.all([
    summarizeWorkLogs(now.date, now.date),
    summarizeLifeLogs(now.date, now.date),
  ]);
  return {
    date: now.date,
    profile,
    plan: getDailyPlan(chatId, now.date),
    work,
    life,
    reminders: listReminders(chatId),
    recentThemes: getRecentHeartbeatThemes(chatId, 3),
    contexts: listActiveHeartbeatContexts(chatId, 5),
  };
}
