import { Router, type Request, type Response, type NextFunction } from "express";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { getDb, getUserStats, storeFact } from "../memory/sqlite.js";
import { addEntity, addRelation } from "../memory/knowledge-graph.js";
import { getCoachProfile } from "../coach.js";
import { listDailySummaries } from "../coach.js";
import { getDailyPlan, getDailyPlanStats, getTodayPlanDate, updateDailyPlanItem, completeDailyPlanItem } from "../daily-plan.js";
import { getWorkLogs, getLifeLogs } from "../memory/local-logs.js";
import { getToolDefinitions } from "../tools/index.js";
import { getScheduledTasksList } from "../scheduler/index.js";
import { getConnectedServersList, getMcpConfigPath } from "../mcp/index.js";
import { getLoadedSkills, loadSkills } from "../skills/index.js";
import { executeWorkflow } from "../workflows/engine.js";
import { getWebhooksList } from "./index.js";

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});

// ── Helpers ────────────────────────────────────────────────────

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

const serverStartedAt = Date.now();
const chatId = () => config.allowedUserIds[0];

// ═══════════════════════════════════════════════════════════════
// COMMAND CENTER
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/stats", (_req: Request, res: Response) => {
  try {
    const cid = chatId();
    const today = getTodayIST();
    const userStats = getUserStats(cid);

    const heartbeatsToday = (
      getDb().prepare("SELECT COUNT(*) as count FROM heartbeat_events WHERE chatId = ? AND eventDate = ?")
        .get(cid, today) as { count: number }
    ).count;

    const expToday = (
      getDb().prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM exp_log
         WHERE chatId = ? AND createdAt >= datetime(?, '-5 hours', '+30 minutes')`
      ).get(cid, today + "T00:00:00") as { total: number }
    ).total;

    const totalFacts = (
      getDb().prepare("SELECT COUNT(*) as count FROM facts WHERE chatId = ?")
        .get(cid) as { count: number }
    ).count;

    const uptimeMs = Date.now() - serverStartedAt;
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

    const plan = getDailyPlan(cid, today);
    const planStats = getDailyPlanStats(plan);

    res.json({
      level: userStats.level,
      totalExp: userStats.totalExp,
      expToday,
      heartbeatsToday,
      totalFacts,
      uptime: `${uptimeHours}h ${uptimeMins}m`,
      uptimeMs,
      plan: { total: planStats.total, done: planStats.done, mustTotal: planStats.mustTotal, mustDone: planStats.mustDone },
    });
  } catch (err) {
    console.error("❌ Dashboard /stats error:", err);
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/activity", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const heartbeats = getDb()
      .prepare(
        `SELECT id, eventDate, eventTime, theme, toneMode, message, reason, userResponded, createdAt
         FROM heartbeat_events WHERE chatId = ? ORDER BY id DESC LIMIT ?`
      )
      .all(cid, limit) as Array<{
        id: number; eventDate: string; eventTime: string; theme: string;
        toneMode: string; message: string; reason: string; userResponded: number; createdAt: string;
      }>;

    const expEvents = getDb()
      .prepare(`SELECT id, amount, reason, createdAt FROM exp_log WHERE chatId = ? ORDER BY id DESC LIMIT ?`)
      .all(cid, limit) as Array<{ id: number; amount: number; reason: string; createdAt: string }>;

    const combined = [
      ...heartbeats.map((h) => ({
        type: "heartbeat" as const, id: `hb-${h.id}`, theme: h.theme,
        message: h.message.substring(0, 200), reason: h.reason,
        responded: h.userResponded === 1, createdAt: h.createdAt,
      })),
      ...expEvents.map((e) => ({
        type: "exp" as const, id: `exp-${e.id}`, amount: e.amount,
        reason: e.reason, createdAt: e.createdAt,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ activity: combined.slice(0, limit) });
  } catch (err) {
    console.error("❌ Dashboard /activity error:", err);
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/config", (_req: Request, res: Response) => {
  try {
    const cid = chatId();
    const profile = getCoachProfile(cid);

    res.json({
      agent: {
        name: "MyCortex", version: "0.2.0", model: config.llmModel,
        backupModel: config.backupModel || null, maxIterations: config.maxAgentIterations,
      },
      coach: {
        toneMode: profile.toneMode, encouragementStyle: profile.encouragementStyle,
        pressureStyle: profile.pressureStyle, driftScore: profile.driftScore,
        loggingReliability: profile.loggingReliability,
        activeHours: `${profile.activeStartHour}:00 – ${profile.activeEndHour}:00 IST`,
      },
      integrations: {
        todoist: !!config.todoistApiToken, googleSheets: !!config.googleSheetId,
        sarvamTTS: !!config.sarvamApiKey, pinecone: !!config.pineconeApiKey,
      },
      memory: {
        decayDays: config.memoryDecayDays, maxContextTokens: config.maxContextTokens,
        semanticEnabled: !!config.pineconeApiKey,
      },
    });
  } catch (err) {
    console.error("❌ Dashboard /config error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// TASKS / DAILY PLAN
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/plan", (_req: Request, res: Response) => {
  try {
    const cid = chatId();
    const today = getTodayPlanDate();
    const plan = getDailyPlan(cid, today);

    if (!plan) { res.json({ plan: null, stats: null }); return; }

    const stats = getDailyPlanStats(plan);
    res.json({
      plan: {
        id: plan.id, planDate: plan.planDate, status: plan.status,
        items: plan.items.map((item) => ({
          id: item.id, title: item.title, category: item.category,
          priority: item.priority, status: item.status, timeBlock: item.timeBlock,
        })),
      },
      stats,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.post("/plan/items/:id/complete", async (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const itemId = Number(req.params.id);
    await completeDailyPlanItem(cid, itemId, true);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.post("/plan/items/:id/update", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const itemId = Number(req.params.id);
    const { status, title, priority } = req.body as { status?: string; title?: string; priority?: string };
    updateDailyPlanItem(cid, itemId, { status, title, priority });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// SETTINGS — Coach Profile
// ═══════════════════════════════════════════════════════════════

dashboardRouter.post("/config/coach", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const { toneMode, encouragementStyle, pressureStyle } = req.body as {
      toneMode?: string; encouragementStyle?: string; pressureStyle?: string;
    };

    const updates: string[] = [];
    const params: unknown[] = [];

    if (toneMode) { updates.push("toneMode = ?"); params.push(toneMode); }
    if (encouragementStyle) { updates.push("encouragementStyle = ?"); params.push(encouragementStyle); }
    if (pressureStyle) { updates.push("pressureStyle = ?"); params.push(pressureStyle); }

    if (updates.length > 0) {
      params.push(cid);
      getDb().prepare(`UPDATE coach_profiles SET ${updates.join(", ")} WHERE chatId = ?`).run(...params);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECOND BRAIN — Facts
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/brain/facts", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const q = (req.query.q as string) || "";
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let facts;
    if (q) {
      facts = getDb().prepare(
        `SELECT id, key, value, category, importance, accessCount, createdAt, lastAccessed
         FROM facts WHERE chatId = ? AND (key LIKE ? OR value LIKE ? OR category LIKE ?)
         ORDER BY lastAccessed DESC LIMIT ?`
      ).all(cid, `%${q}%`, `%${q}%`, `%${q}%`, limit);
    } else {
      facts = getDb().prepare(
        `SELECT id, key, value, category, importance, accessCount, createdAt, lastAccessed
         FROM facts WHERE chatId = ? ORDER BY lastAccessed DESC LIMIT ?`
      ).all(cid, limit);
    }

    res.json({ facts });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.post("/brain/facts", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const { key, value, category } = req.body as { key: string; value: string; category: string };
    if (!key || !value) { res.status(400).json({ error: "key and value required" }); return; }
    storeFact(cid, key, value, category || "general");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.delete("/brain/facts/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    getDb().prepare("DELETE FROM facts WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Entities ──────────────────────────────────────────────────

dashboardRouter.get("/brain/entities", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const q = (req.query.q as string) || "";
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let entities;
    if (q) {
      entities = getDb().prepare(
        `SELECT id, name, type, properties, importance, createdAt
         FROM entities WHERE chatId = ? AND (name LIKE ? OR type LIKE ?)
         ORDER BY importance DESC LIMIT ?`
      ).all(cid, `%${q}%`, `%${q}%`, limit);
    } else {
      entities = getDb().prepare(
        `SELECT id, name, type, properties, importance, createdAt
         FROM entities WHERE chatId = ? ORDER BY importance DESC LIMIT ?`
      ).all(cid, limit);
    }

    res.json({ entities });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.post("/brain/entities", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const { name, type, properties } = req.body as { name: string; type: string; properties?: string };
    if (!name || !type) { res.status(400).json({ error: "name and type required" }); return; }
    addEntity(cid, name, type, properties ? JSON.parse(properties) : {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.delete("/brain/entities/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    getDb().prepare("DELETE FROM entities WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Relations ─────────────────────────────────────────────────

dashboardRouter.get("/brain/relations", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const q = (req.query.q as string) || "";
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let relations;
    if (q) {
      relations = getDb().prepare(
        `SELECT id, fromEntity, toEntity, relationType, importance
         FROM relations WHERE chatId = ? AND (fromEntity LIKE ? OR toEntity LIKE ? OR relationType LIKE ?)
         ORDER BY importance DESC LIMIT ?`
      ).all(cid, `%${q}%`, `%${q}%`, `%${q}%`, limit);
    } else {
      relations = getDb().prepare(
        `SELECT id, fromEntity, toEntity, relationType, importance
         FROM relations WHERE chatId = ? ORDER BY importance DESC LIMIT ?`
      ).all(cid, limit);
    }

    res.json({ relations });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.post("/brain/relations", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const { from, to, relationType } = req.body as { from: string; to: string; relationType: string };
    if (!from || !to || !relationType) { res.status(400).json({ error: "from, to, relationType required" }); return; }
    addRelation(cid, from, to, relationType);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.delete("/brain/relations/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    getDb().prepare("DELETE FROM relations WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// LOGS & ANALYTICS
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/logs/work", async (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const logs = await getWorkLogs(cid, limit);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/logs/life", async (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const logs = await getLifeLogs(cid, limit, from, to);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/logs/summaries", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const limit = Math.min(Number(req.query.limit) || 14, 60);
    const summaries = listDailySummaries(cid, limit);
    res.json({ summaries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/logs/exp", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const days = Math.min(Number(req.query.days) || 30, 90);
    const entries = getDb().prepare(
      `SELECT id, amount, reason, createdAt FROM exp_log
       WHERE chatId = ? AND createdAt >= datetime('now', ? || ' days')
       ORDER BY createdAt DESC`
    ).all(cid, `-${days}`) as Array<{ id: number; amount: number; reason: string; createdAt: string }>;
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/logs/exp/trend", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const days = Math.min(Number(req.query.days) || 30, 90);
    const trend = getDb().prepare(
      `SELECT date(createdAt) as date, SUM(amount) as total FROM exp_log
       WHERE chatId = ? AND createdAt >= datetime('now', ? || ' days')
       GROUP BY date(createdAt) ORDER BY date ASC`
    ).all(cid, `-${days}`) as Array<{ date: string; total: number }>;
    res.json({ trend });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// CONNECTIONS
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/connections/health", (_req: Request, res: Response) => {
  try {
    const integrations = [
      { name: "Todoist", connected: !!config.todoistApiToken, details: "Task management" },
      { name: "Google Sheets", connected: !!config.googleSheetId, details: "LeetCode & company logging" },
      { name: "Pinecone", connected: !!config.pineconeApiKey, details: "Semantic memory" },
      { name: "Sarvam TTS", connected: !!config.sarvamApiKey, details: "Indian language TTS" },
      { name: "Kokoro TTS", connected: !!config.kokoroUrl, details: "Local text-to-speech" },
      { name: "Local STT", connected: !!config.localSttUrl, details: "Speech-to-text (Whisper)" },
    ];

    const mcpServers = getConnectedServersList();
    if (mcpServers.length > 0) {
      integrations.push({
        name: "MCP Bridge",
        connected: true,
        details: `${mcpServers.length} server(s), ${mcpServers.reduce((s, m) => s + m.toolCount, 0)} tools`,
      });
    }

    res.json({ integrations });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/connections/webhooks", (_req: Request, res: Response) => {
  try {
    res.json({ webhooks: getWebhooksList() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/scheduler/tasks", (_req: Request, res: Response) => {
  try {
    res.json({ tasks: getScheduledTasksList() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// MCP SERVERS
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/mcp/servers", (_req: Request, res: Response) => {
  try {
    res.json({ servers: getConnectedServersList() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/mcp/config", async (_req: Request, res: Response) => {
  try {
    const raw = await readFile(getMcpConfigPath(), "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.json({ mcpServers: {} });
  }
});

// ═══════════════════════════════════════════════════════════════
// SKILLS
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/skills", (_req: Request, res: Response) => {
  try {
    res.json({ skills: getLoadedSkills() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/skills/:name", async (req: Request, res: Response) => {
  try {
    const skillName = String(req.params.name);
    const skills = getLoadedSkills();
    const skill = skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase());
    if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }

    const content = await readFile(skill.filePath, "utf-8");
    res.json({ name: skill.name, content });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.put("/skills/:name", async (req: Request, res: Response) => {
  try {
    const skillName = String(req.params.name);
    const skills = getLoadedSkills();
    const skill = skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase());
    if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }

    const { content } = req.body as { content: string };
    if (!content) { res.status(400).json({ error: "content required" }); return; }

    await writeFile(skill.filePath, content, "utf-8");
    await loadSkills();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.post("/skills", async (req: Request, res: Response) => {
  try {
    const { name, content } = req.body as { name: string; content: string };
    if (!name || !content) { res.status(400).json({ error: "name and content required" }); return; }

    const filename = name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".md";
    const filePath = join(config.skillsDir, filename);
    await writeFile(filePath, content, "utf-8");
    await loadSkills();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.delete("/skills/:name", async (req: Request, res: Response) => {
  try {
    const skillName = String(req.params.name);
    const skills = getLoadedSkills();
    const skill = skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase());
    if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }

    await unlink(skill.filePath);
    await loadSkills();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.post("/skills/reload", async (_req: Request, res: Response) => {
  try {
    await loadSkills();
    res.json({ ok: true, count: getLoadedSkills().length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/tools", (_req: Request, res: Response) => {
  try {
    const defs = getToolDefinitions();
    const tools = defs.map((d) => ({
      name: d.function.name,
      description: d.function.description ?? "",
      parameters: d.function.parameters ?? {},
    }));
    res.json({ tools });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// CONTENT
// ═══════════════════════════════════════════════════════════════

dashboardRouter.get("/content/media", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const media = getDb().prepare(
      `SELECT id, mediaType, filename, description, tags, createdAt
       FROM media_memories WHERE chatId = ? ORDER BY createdAt DESC LIMIT ?`
    ).all(cid, limit);
    res.json({ media });
  } catch (err) {
    res.json({ media: [] });
  }
});

dashboardRouter.get("/content/stats", (req: Request, res: Response) => {
  try {
    const cid = chatId();
    const totalMedia = (getDb().prepare(
      "SELECT COUNT(*) as count FROM media_memories WHERE chatId = ?"
    ).get(cid) as { count: number }).count;
    const totalFacts = (getDb().prepare(
      "SELECT COUNT(*) as count FROM facts WHERE chatId = ?"
    ).get(cid) as { count: number }).count;
    res.json({ totalMedia, totalFacts });
  } catch (err) {
    res.json({ totalMedia: 0, totalFacts: 0 });
  }
});

// ═══════════════════════════════════════════════════════════════
// WORKFLOWS
// ═══════════════════════════════════════════════════════════════

function generateWorkflowId(prefix: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix;
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// List all workflows
dashboardRouter.get("/workflows", (_req: Request, res: Response) => {
  try {
    const rows = getDb()
      .prepare("SELECT * FROM workflows ORDER BY updatedAt DESC")
      .all() as Array<Record<string, unknown>>;

    const workflows = rows.map((r) => ({
      ...r,
      nodes: JSON.parse(r.nodes as string),
      edges: JSON.parse(r.edges as string),
    }));

    res.json({ workflows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single workflow
dashboardRouter.get("/workflows/:id", (req: Request, res: Response) => {
  try {
    const row = getDb()
      .prepare("SELECT * FROM workflows WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!row) { res.status(404).json({ error: "Workflow not found" }); return; }

    res.json({
      ...row,
      nodes: JSON.parse(row.nodes as string),
      edges: JSON.parse(row.edges as string),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create workflow
dashboardRouter.post("/workflows", (req: Request, res: Response) => {
  try {
    const id = generateWorkflowId("wf_");
    const { name, description } = req.body as { name?: string; description?: string };

    getDb().prepare(
      "INSERT INTO workflows (id, name, description) VALUES (?, ?, ?)"
    ).run(id, name || "Untitled Workflow", description || "");

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update workflow
dashboardRouter.put("/workflows/:id", (req: Request, res: Response) => {
  try {
    const { name, description, nodes, edges, status } = req.body as {
      name?: string; description?: string; nodes?: unknown[]; edges?: unknown[]; status?: string;
    };

    const updates: string[] = [];
    const params: unknown[] = [];

    if (name !== undefined) { updates.push("name = ?"); params.push(name); }
    if (description !== undefined) { updates.push("description = ?"); params.push(description); }
    if (nodes !== undefined) { updates.push("nodes = ?"); params.push(JSON.stringify(nodes)); }
    if (edges !== undefined) { updates.push("edges = ?"); params.push(JSON.stringify(edges)); }
    if (status !== undefined) { updates.push("status = ?"); params.push(status); }

    if (updates.length > 0) {
      updates.push("updatedAt = datetime('now')");
      params.push(req.params.id);
      getDb().prepare(`UPDATE workflows SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete workflow (cascade via FK)
dashboardRouter.delete("/workflows/:id", (req: Request, res: Response) => {
  try {
    // Manually delete runs first (better-sqlite3 doesn't always enforce FK cascades)
    getDb().prepare("DELETE FROM workflow_runs WHERE workflowId = ?").run(req.params.id);
    getDb().prepare("DELETE FROM workflows WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Execute workflow
dashboardRouter.post("/workflows/:id/execute", async (req: Request, res: Response) => {
  try {
    const run = await executeWorkflow(String(req.params.id));
    res.json({ ok: true, runId: run.id, status: run.status });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List runs for a workflow
dashboardRouter.get("/workflows/:id/runs", (req: Request, res: Response) => {
  try {
    const rows = getDb()
      .prepare("SELECT * FROM workflow_runs WHERE workflowId = ? ORDER BY startedAt DESC LIMIT 50")
      .all(req.params.id) as Array<Record<string, unknown>>;

    const runs = rows.map((r) => ({
      ...r,
      nodeResults: JSON.parse(r.nodeResults as string),
    }));

    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single run
dashboardRouter.get("/workflows/runs/:runId", (req: Request, res: Response) => {
  try {
    const row = getDb()
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(req.params.runId) as Record<string, unknown> | undefined;

    if (!row) { res.status(404).json({ error: "Run not found" }); return; }

    res.json({
      ...row,
      nodeResults: JSON.parse(row.nodeResults as string),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
