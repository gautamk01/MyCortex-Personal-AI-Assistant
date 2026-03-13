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
      SELECT key, value, category, importance, accessCount
      FROM facts WHERE chatId = ? AND (key LIKE ? OR value LIKE ? OR category LIKE ?)
      ORDER BY importance DESC, accessCount DESC
      LIMIT 20
    `);
    const pattern = `%${query}%`;
    rows = stmt.all(chatId, pattern, pattern, pattern);
  } else {
    const stmt = getDb().prepare(`
      SELECT key, value, category, importance, accessCount
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
  for (const row of rows as Array<{ key: string }>) {
    trackFactAccess(chatId, row.key);
  }

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

function trackFactAccess(chatId: number, key: string): void {
  try {
    const fact = getDb()
      .prepare("SELECT id FROM facts WHERE chatId = ? AND key = ?")
      .get(chatId, key.toLowerCase()) as { id: number } | undefined;

    if (fact) {
      getDb()
        .prepare(
          "UPDATE facts SET accessCount = accessCount + 1, lastAccessed = datetime('now') WHERE id = ?"
        )
        .run(fact.id);
      getDb()
        .prepare("INSERT INTO access_log (factId) VALUES (?)")
        .run(fact.id);
    }
  } catch {
    // Non-critical — don't break recall on tracking errors
  }
}
