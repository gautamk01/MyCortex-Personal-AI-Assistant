import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

// ── Singleton DB ───────────────────────────────────────────────

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

// ── Schema ─────────────────────────────────────────────────────

export function initDatabase(): void {
  // Ensure data directory exists
  mkdirSync(dirname(config.memoryDbPath), { recursive: true });

  db = new Database(config.memoryDbPath);

  // Enable WAL mode for better concurrency
  db.pragma("journal_mode = WAL");

  // ── Facts / Preferences table
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId      INTEGER NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      category    TEXT DEFAULT 'general',
      importance  REAL DEFAULT 1.0,
      accessCount INTEGER DEFAULT 0,
      createdAt   TEXT DEFAULT (datetime('now')),
      updatedAt   TEXT DEFAULT (datetime('now')),
      lastAccessed TEXT DEFAULT (datetime('now')),
      UNIQUE(chatId, key)
    )
  `);

  // ── Entities table (knowledge graph)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId     INTEGER NOT NULL,
      name       TEXT NOT NULL,
      type       TEXT DEFAULT 'thing',
      properties TEXT DEFAULT '{}',
      importance  REAL DEFAULT 1.0,
      accessCount INTEGER DEFAULT 0,
      lastAccessed TEXT DEFAULT (datetime('now')),
      createdAt  TEXT DEFAULT (datetime('now')),
      updatedAt  TEXT DEFAULT (datetime('now')),
      UNIQUE(chatId, name)
    )
  `);

  // ── Relations table (knowledge graph)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId       INTEGER NOT NULL,
      fromEntity   TEXT NOT NULL,
      toEntity     TEXT NOT NULL,
      relationType TEXT NOT NULL,
      properties   TEXT DEFAULT '{}',
      importance  REAL DEFAULT 1.0,
      accessCount INTEGER DEFAULT 0,
      lastAccessed TEXT DEFAULT (datetime('now')),
      createdAt    TEXT DEFAULT (datetime('now')),
      UNIQUE(chatId, fromEntity, toEntity, relationType)
    )
  `);

  // ── Media memories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_memories (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId        INTEGER NOT NULL,
      mediaType     TEXT NOT NULL,
      filename      TEXT NOT NULL,
      description   TEXT DEFAULT '',
      extractedText TEXT DEFAULT '',
      tags          TEXT DEFAULT '[]',
      createdAt     TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Access log for evolution tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      factId    INTEGER NOT NULL,
      accessedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (factId) REFERENCES facts(id) ON DELETE CASCADE
    )
  `);

  // ── Gamification: User Stats
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_stats (
      chatId      INTEGER PRIMARY KEY,
      level       INTEGER DEFAULT 1,
      totalExp    INTEGER DEFAULT 0,
      createdAt   TEXT DEFAULT (datetime('now')),
      updatedAt   TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Gamification: EXP Log
  db.exec(`
    CREATE TABLE IF NOT EXISTS exp_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId      INTEGER NOT NULL,
      amount      INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      createdAt   TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Daily planning: one plan per day with linked execution items
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_plans (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId      INTEGER NOT NULL,
      planDate    TEXT NOT NULL,
      status      TEXT DEFAULT 'active',
      createdAt   TEXT DEFAULT (datetime('now')),
      updatedAt   TEXT DEFAULT (datetime('now')),
      UNIQUE(chatId, planDate)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_plan_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      planId        INTEGER NOT NULL,
      chatId        INTEGER NOT NULL,
      title         TEXT NOT NULL,
      category      TEXT DEFAULT 'other',
      priority      TEXT DEFAULT 'should',
      status        TEXT DEFAULT 'planned',
      timeBlock     TEXT DEFAULT '',
      todoistTaskId TEXT DEFAULT '',
      todoistUrl    TEXT DEFAULT '',
      reflection    TEXT DEFAULT '',
      sortOrder     INTEGER DEFAULT 0,
      createdAt     TEXT DEFAULT (datetime('now')),
      updatedAt     TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (planId) REFERENCES daily_plans(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_profiles (
      chatId              INTEGER PRIMARY KEY,
      toneMode            TEXT DEFAULT 'normal',
      encouragementStyle  TEXT DEFAULT 'warm_firm',
      pressureStyle       TEXT DEFAULT 'firm',
      driftScore          REAL DEFAULT 0,
      loggingReliability  REAL DEFAULT 0.5,
      activeStartHour     INTEGER DEFAULT 8,
      activeEndHour       INTEGER DEFAULT 22,
      lastActiveAt        TEXT DEFAULT (datetime('now')),
      updatedAt           TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId        INTEGER NOT NULL,
      eventDate     TEXT NOT NULL,
      eventTime     TEXT NOT NULL,
      theme         TEXT NOT NULL,
      toneMode      TEXT NOT NULL,
      message       TEXT NOT NULL,
      reason        TEXT DEFAULT '',
      userResponded INTEGER DEFAULT 0,
      createdAt     TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_summaries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId       INTEGER NOT NULL,
      summaryDate  TEXT NOT NULL,
      summaryText  TEXT NOT NULL,
      metricsJson  TEXT NOT NULL,
      createdAt    TEXT DEFAULT (datetime('now')),
      updatedAt    TEXT DEFAULT (datetime('now')),
      UNIQUE(chatId, summaryDate)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reminder_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId       INTEGER NOT NULL,
      reminderId   TEXT NOT NULL,
      eventType    TEXT NOT NULL,
      dueAtIso     TEXT DEFAULT '',
      detailsJson  TEXT DEFAULT '{}',
      createdAt    TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat_contexts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId        INTEGER NOT NULL,
      contextKey    TEXT NOT NULL,
      sourceType    TEXT NOT NULL,
      subject       TEXT NOT NULL,
      status        TEXT DEFAULT 'active',
      evidenceJson  TEXT DEFAULT '{}',
      firstSeenAt   TEXT DEFAULT (datetime('now')),
      lastSeenAt    TEXT DEFAULT (datetime('now')),
      lastAskedAt   TEXT DEFAULT '',
      askCount      INTEGER DEFAULT 0,
      createdAt     TEXT DEFAULT (datetime('now')),
      updatedAt     TEXT DEFAULT (datetime('now')),
      UNIQUE(chatId, contextKey, sourceType)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS work_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER NOT NULL,
      logDate TEXT NOT NULL,
      category TEXT NOT NULL,
      durationMinutes INTEGER NOT NULL,
      description TEXT NOT NULL,
      expAdded INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS life_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER NOT NULL,
      logDate TEXT NOT NULL,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      durationMinutes INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  // Check and add lastActiveAt column to coach_profiles if it's missing (migration)
  const coachCols = getDb().prepare(`PRAGMA table_info(coach_profiles)`).all() as { name: string }[];
  if (!coachCols.some((c) => c.name === "lastActiveAt")) {
    getDb().prepare(`ALTER TABLE coach_profiles ADD COLUMN lastActiveAt TEXT`).run();
    getDb().prepare(`UPDATE coach_profiles SET lastActiveAt = datetime('now')`).run();
  }

  console.log("🧠 SQLite memory database initialized");
}

// ── Facts CRUD ─────────────────────────────────────────────────

export function storeFact(
  chatId: number,
  key: string,
  value: string,
  category: string = "general"
): string {
  const stmt = getDb().prepare(`
    INSERT INTO facts (chatId, key, value, category, updatedAt)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chatId, key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      updatedAt = datetime('now')
  `);
  stmt.run(chatId, key.toLowerCase(), value, category);
  return `Remembered: "${key}" = "${value}"`;
}

export function recallFacts(chatId: number, query?: string): string {
  let rows;
  if (query) {
    const stmt = getDb().prepare(`
      SELECT id, key, value, category, importance, accessCount
      FROM facts WHERE chatId = ? AND (key LIKE ? OR value LIKE ? OR category LIKE ?)
      ORDER BY importance DESC, accessCount DESC
      LIMIT 20
    `);
    const pattern = `%${query}%`;
    rows = stmt.all(chatId, pattern, pattern, pattern);
  } else {
    const stmt = getDb().prepare(`
      SELECT id, key, value, category, importance, accessCount
      FROM facts WHERE chatId = ?
      ORDER BY importance DESC, updatedAt DESC
      LIMIT 30
    `);
    rows = stmt.all(chatId);
  }

  if (!rows || rows.length === 0) {
    return query
      ? `No memories found matching "${query}".`
      : "No memories stored yet.";
  }

  // Track access
  trackFactAccessBatch((rows as Array<{ id: number }>).map((row) => row.id));

  return (rows as Array<{ key: string; value: string; category: string }>)
    .map((r) => `[${r.category}] ${r.key}: ${r.value}`)
    .join("\n");
}

export function forgetFact(chatId: number, key: string): string {
  const stmt = getDb().prepare(
    "DELETE FROM facts WHERE chatId = ? AND key = ?"
  );
  const result = stmt.run(chatId, key.toLowerCase());
  return result.changes > 0
    ? `Forgotten: "${key}"`
    : `No memory found with key "${key}".`;
}

/**
 * Get formatted memory context for injection into the system prompt.
 */
export function getMemoryContext(chatId: number): string {
  const stmt = getDb().prepare(`
    SELECT key, value, category FROM facts
    WHERE chatId = ?
    ORDER BY importance DESC, updatedAt DESC, accessCount DESC
    LIMIT 40
  `);
  const rows = stmt.all(chatId) as Array<{
    key: string;
    value: string;
    category: string;
  }>;

  if (rows.length === 0) return "";

  const lines = rows.map((r) => `- [${r.category}] ${r.key}: ${r.value}`);
  return `\n## Stored Memories\n${lines.join("\n")}`;
}

export interface UserIdentity {
  nickname: string;
  preferredName: string;
  name: string;
  displayName: string;
  displaySource: "nickname" | "preferred_name" | "name" | "neutral";
}

export function resolveUserIdentity(chatId: number): UserIdentity {
  const rows = getDb()
    .prepare(`
      SELECT key, value
      FROM facts
      WHERE chatId = ?
        AND key IN ('nickname', 'preferred_name', 'name', 'father_name', 'dad_name', 'mother_name')
    `)
    .all(chatId) as Array<{ key: string; value: string }>;

  const values = new Map(rows.map((row) => [row.key.toLowerCase(), row.value.trim()]));
  const nickname = values.get("nickname") ?? "";
  const preferredName = values.get("preferred_name") ?? "";
  const name = values.get("name") ?? "";
  const familyNames = new Set([
    values.get("father_name"),
    values.get("dad_name"),
    values.get("mother_name"),
  ].filter((value): value is string => Boolean(value)));

  if (nickname) {
    return {
      nickname,
      preferredName,
      name,
      displayName: nickname,
      displaySource: "nickname",
    };
  }

  if (preferredName) {
    return {
      nickname,
      preferredName,
      name,
      displayName: preferredName,
      displaySource: "preferred_name",
    };
  }

  if (name && !familyNames.has(name)) {
    return {
      nickname,
      preferredName,
      name,
      displayName: name,
      displaySource: "name",
    };
  }

  return {
    nickname,
    preferredName,
    name,
    displayName: "",
    displaySource: "neutral",
  };
}

export function getUserIdentityContext(chatId: number): string {
  const identity = resolveUserIdentity(chatId);
  const lines = [
    "\n## User Identity",
    `- display_name: ${identity.displayName || "unknown"}`,
    `- display_source: ${identity.displaySource}`,
    `- nickname: ${identity.nickname || "unknown"}`,
    `- preferred_name: ${identity.preferredName || "unknown"}`,
    `- name: ${identity.name || "unknown"}`,
  ];

  if (identity.displayName) {
    lines.push("- use the resolved display_name naturally in most replies, but do not force it into every sentence");
  } else {
    lines.push("- no reliable nickname or display name is known yet");
  }

  return lines.join("\n");
}

// ── Gamification CRUD ──────────────────────────────────────────

export function getUserStats(chatId: number): { level: number; totalExp: number } {
  let stats = getDb()
    .prepare("SELECT level, totalExp FROM user_stats WHERE chatId = ?")
    .get(chatId) as { level: number; totalExp: number } | undefined;

  if (!stats) {
    getDb()
      .prepare("INSERT INTO user_stats (chatId) VALUES (?)")
      .run(chatId);
    stats = { level: 1, totalExp: 0 };
  }
  return stats;
}

export function addExp(chatId: number, amount: number, reason: string): { newTotal: number; levelUp: boolean; newLevel: number } {
  const current = getUserStats(chatId);
  const newTotal = current.totalExp + amount;
  
  // Simple leveling formula: Level = Math.floor(sqrt(totalExp / 100)) + 1
  // E.g.
  // 0-399 exp = level 1, 2
  // Let's use a simpler one: 100 exp per level
  const newLevel = Math.floor(newTotal / 100) + 1;
  const levelUp = newLevel > current.level;

  const stmt = getDb().prepare(`
    UPDATE user_stats 
    SET totalExp = ?, level = ?, updatedAt = datetime('now')
    WHERE chatId = ?
  `);
  stmt.run(newTotal, newLevel, chatId);

  const logStmt = getDb().prepare(`
    INSERT INTO exp_log (chatId, amount, reason) VALUES (?, ?, ?)
  `);
  logStmt.run(chatId, amount, reason);

  return { newTotal, levelUp, newLevel };
}

// ── Helpers ────────────────────────────────────────────────────

function trackFactAccessBatch(factIds: number[]): void {
  if (factIds.length === 0) return;

  try {
    const db = getDb();
    const idPlaceholders = factIds.map(() => "?").join(", ");
    const insertValues = factIds.map(() => "(?)").join(", ");

    db.transaction((ids: number[]) => {
      db.prepare(
        `UPDATE facts
         SET accessCount = accessCount + 1, lastAccessed = datetime('now')
         WHERE id IN (${idPlaceholders})`
      ).run(...ids);
      db.prepare(`INSERT INTO access_log (factId) VALUES ${insertValues}`).run(...ids);
    })(factIds);
  } catch {
    // Non-critical — don't break recall on tracking errors
  }
}
