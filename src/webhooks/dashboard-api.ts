import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config.js";
import { getDb, getUserStats } from "../memory/sqlite.js";
import { getCoachProfile } from "../coach.js";
import { getDailyPlan, getDailyPlanStats, getTodayPlanDate } from "../daily-plan.js";

export const dashboardRouter = Router();

// ── Auth Middleware ─────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers["x-dashboard-secret"] as string | undefined;
  if (!config.dashboardSecret || secret !== config.dashboardSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

dashboardRouter.use(requireAuth);

// ── CORS for local Next.js dev ─────────────────────────────────

dashboardRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dashboard-secret");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

// ── Helper: get start of today IST ─────────────────────────────

function getTodayIST(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

// keep track of when the server started
const serverStartedAt = Date.now();

// ── GET /stats ─────────────────────────────────────────────────
// Overview stats for the Command Center

dashboardRouter.get("/stats", (_req: Request, res: Response) => {
  try {
    const chatId = config.allowedUserIds[0];
    const today = getTodayIST();

    // User gamification stats
    const userStats = getUserStats(chatId);

    // Heartbeats today
    const heartbeatsToday = (
      getDb()
        .prepare("SELECT COUNT(*) as count FROM heartbeat_events WHERE chatId = ? AND eventDate = ?")
        .get(chatId, today) as { count: number }
    ).count;

    // EXP earned today
    const expToday = (
      getDb()
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total FROM exp_log
           WHERE chatId = ? AND createdAt >= datetime(?, '-5 hours', '+30 minutes')`
        )
        .get(chatId, today + "T00:00:00") as { total: number }
    ).total;

    // Total facts stored
    const totalFacts = (
      getDb()
        .prepare("SELECT COUNT(*) as count FROM facts WHERE chatId = ?")
        .get(chatId) as { count: number }
    ).count;

    // Uptime
    const uptimeMs = Date.now() - serverStartedAt;
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

    // Daily plan progress
    const plan = getDailyPlan(chatId, today);
    const planStats = getDailyPlanStats(plan);

    res.json({
      level: userStats.level,
      totalExp: userStats.totalExp,
      expToday,
      heartbeatsToday,
      totalFacts,
      uptime: `${uptimeHours}h ${uptimeMins}m`,
      uptimeMs,
      plan: {
        total: planStats.total,
        done: planStats.done,
        mustTotal: planStats.mustTotal,
        mustDone: planStats.mustDone,
      },
    });
  } catch (err) {
    console.error("❌ Dashboard /stats error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /activity ──────────────────────────────────────────────
// Recent activity feed (heartbeats + exp events)

dashboardRouter.get("/activity", (req: Request, res: Response) => {
  try {
    const chatId = config.allowedUserIds[0];
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    // Heartbeat events
    const heartbeats = getDb()
      .prepare(
        `SELECT id, eventDate, eventTime, theme, toneMode, message, reason, userResponded, createdAt
         FROM heartbeat_events
         WHERE chatId = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(chatId, limit) as Array<{
      id: number;
      eventDate: string;
      eventTime: string;
      theme: string;
      toneMode: string;
      message: string;
      reason: string;
      userResponded: number;
      createdAt: string;
    }>;

    // EXP events
    const expEvents = getDb()
      .prepare(
        `SELECT id, amount, reason, createdAt
         FROM exp_log
         WHERE chatId = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(chatId, limit) as Array<{
      id: number;
      amount: number;
      reason: string;
      createdAt: string;
    }>;

    // Merge and sort by createdAt desc
    const combined = [
      ...heartbeats.map((h) => ({
        type: "heartbeat" as const,
        id: `hb-${h.id}`,
        theme: h.theme,
        message: h.message.substring(0, 200),
        reason: h.reason,
        responded: h.userResponded === 1,
        createdAt: h.createdAt,
      })),
      ...expEvents.map((e) => ({
        type: "exp" as const,
        id: `exp-${e.id}`,
        amount: e.amount,
        reason: e.reason,
        createdAt: e.createdAt,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ activity: combined.slice(0, limit) });
  } catch (err) {
    console.error("❌ Dashboard /activity error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /config ────────────────────────────────────────────────
// Agent configuration info

dashboardRouter.get("/config", (_req: Request, res: Response) => {
  try {
    const chatId = config.allowedUserIds[0];
    const profile = getCoachProfile(chatId);

    res.json({
      agent: {
        name: "MyCortex",
        version: "0.2.0",
        model: config.llmModel,
        backupModel: config.backupModel || null,
        maxIterations: config.maxAgentIterations,
      },
      coach: {
        toneMode: profile.toneMode,
        encouragementStyle: profile.encouragementStyle,
        pressureStyle: profile.pressureStyle,
        driftScore: profile.driftScore,
        loggingReliability: profile.loggingReliability,
        activeHours: `${profile.activeStartHour}:00 – ${profile.activeEndHour}:00 IST`,
      },
      integrations: {
        todoist: !!config.todoistApiToken,
        googleSheets: !!config.googleSheetId,
        sarvamTTS: !!config.sarvamApiKey,
        pinecone: !!config.pineconeApiKey,
      },
      memory: {
        decayDays: config.memoryDecayDays,
        maxContextTokens: config.maxContextTokens,
        semanticEnabled: !!config.pineconeApiKey,
      },
    });
  } catch (err) {
    console.error("❌ Dashboard /config error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /plan ──────────────────────────────────────────────────
// Today's daily plan

dashboardRouter.get("/plan", (_req: Request, res: Response) => {
  try {
    const chatId = config.allowedUserIds[0];
    const today = getTodayPlanDate();
    const plan = getDailyPlan(chatId, today);

    if (!plan) {
      res.json({ plan: null, stats: null });
      return;
    }

    const stats = getDailyPlanStats(plan);

    res.json({
      plan: {
        id: plan.id,
        planDate: plan.planDate,
        status: plan.status,
        items: plan.items.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          priority: item.priority,
          status: item.status,
          timeBlock: item.timeBlock,
        })),
      },
      stats,
    });
  } catch (err) {
    console.error("❌ Dashboard /plan error:", err);
    res.status(500).json({ error: String(err) });
  }
});
