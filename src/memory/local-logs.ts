import { getDb, addExp } from "./sqlite.js";

// ── Types ──────────────────────────────────────────────────────

export interface WorkLog {
  id: number;
  chatId: number;
  logDate: string;
  category: string;
  durationMinutes: number;
  description: string;
  expAdded: number;
  createdAt: string;
  updatedAt: string;
}

export interface LifeLog {
  id: number;
  chatId: number;
  logDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  category: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// ── Work Logs ──────────────────────────────────────────────────

export async function logWorkSession(
  chatId: number,
  logDate: string,
  category: string,
  durationMinutes: number,
  description: string
): Promise<{ success: boolean; expAdded: number; newTotal: number; levelUp: boolean; newLevel: number }> {
  // Simple EXP logic: 1 EXP per minute for productive, -1 for entertainment, 0 for neutral
  let expMultiplier = 0;
  const c = category.toLowerCase();
  if (c.includes("coding") || c.includes("study") || c.includes("work") || c.includes("project")) {
    expMultiplier = 1;
  } else if (c.includes("game") || c.includes("entertainment") || c.includes("social")) {
    expMultiplier = -1;
  }

  const expAdded = durationMinutes * expMultiplier;

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO work_logs (chatId, logDate, category, durationMinutes, description, expAdded)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(chatId, logDate, category, durationMinutes, description, expAdded);

  const stats = addExp(chatId, expAdded, `Work log: ${category} for ${durationMinutes}m`);

  return {
    success: true,
    expAdded,
    newTotal: stats.newTotal,
    levelUp: stats.levelUp,
    newLevel: stats.newLevel,
  };
}

export async function getWorkLogs(chatId: number, limit = 10): Promise<WorkLog[]> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM work_logs
    WHERE chatId = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  return stmt.all(chatId, limit) as WorkLog[];
}

export async function updateWorkLog(
  id: number,
  updates: {
    logDate?: string;
    category?: string;
    durationMinutes?: number;
    description?: string;
  }
): Promise<void> {
  const db = getDb();
  
  const setClauses: string[] = [];
  const params: any[] = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }
  
  if (setClauses.length === 0) return;
  
  setClauses.push(`updatedAt = datetime('now')`);
  params.push(id);
  
  const stmt = db.prepare(`
    UPDATE work_logs
    SET ${setClauses.join(", ")}
    WHERE id = ?
  `);
  stmt.run(...params);
}

export async function deleteWorkLog(id: number): Promise<void> {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM work_logs WHERE id = ?`);
  stmt.run(id);
}

export async function summarizeWorkLogs(chatId: number, dateFrom?: string, dateTo?: string) {
  const db = getDb();
  let query = `SELECT * FROM work_logs WHERE chatId = ?`;
  const params: any[] = [chatId];

  if (dateFrom) {
    query += ` AND logDate >= ?`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND logDate <= ?`;
    params.push(dateTo);
  }
  
  query += ` ORDER BY logDate ASC, id ASC`;
  
  const logs = db.prepare(query).all(...params) as WorkLog[];
  
  let totalMinutes = 0;
  let totalExp = 0;
  const totalsByCategory: Record<string, number> = {};
  
  for (const log of logs) {
    totalMinutes += log.durationMinutes;
    totalExp += log.expAdded;
    totalsByCategory[log.category] = (totalsByCategory[log.category] || 0) + log.durationMinutes;
  }
  
  return {
    logs,
    totalMinutes,
    totalExp,
    totalsByCategory,
    dateFrom,
    dateTo
  };
}

// ── Life Logs ──────────────────────────────────────────────────

export async function logLifeEvent(input: {
  chatId: number;
  logDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  category: string;
  description: string;
}): Promise<boolean> {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO life_logs (chatId, logDate, startTime, endTime, durationMinutes, category, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    input.chatId,
    input.logDate,
    input.startTime,
    input.endTime,
    input.durationMinutes,
    input.category,
    input.description
  );
  return true;
}

export async function getLifeLogs(chatId: number, limit = 10, dateFrom?: string, dateTo?: string): Promise<LifeLog[]> {
  const db = getDb();
  let query = `SELECT * FROM life_logs WHERE chatId = ?`;
  const params: any[] = [chatId];

  if (dateFrom) {
    query += ` AND logDate >= ?`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND logDate <= ?`;
    params.push(dateTo);
  }
  
  query += ` ORDER BY logDate DESC, startTime DESC LIMIT ?`;
  params.push(limit);
  
  return db.prepare(query).all(...params) as LifeLog[];
}

export async function updateLifeLog(
  id: number,
  updates: {
    logDate?: string;
    startTime?: string;
    endTime?: string;
    durationMinutes?: number;
    category?: string;
    description?: string;
  }
): Promise<void> {
  const db = getDb();
  
  const setClauses: string[] = [];
  const params: any[] = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }
  
  if (setClauses.length === 0) return;
  
  setClauses.push(`updatedAt = datetime('now')`);
  params.push(id);
  
  const stmt = db.prepare(`
    UPDATE life_logs
    SET ${setClauses.join(", ")}
    WHERE id = ?
  `);
  stmt.run(...params);
}

export async function deleteLifeLog(id: number): Promise<void> {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM life_logs WHERE id = ?`);
  stmt.run(id);
}

export async function summarizeLifeLogs(chatId: number, dateFrom?: string, dateTo?: string) {
  const db = getDb();
  let query = `SELECT * FROM life_logs WHERE chatId = ?`;
  const params: any[] = [chatId];

  if (dateFrom) {
    query += ` AND logDate >= ?`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND logDate <= ?`;
    params.push(dateTo);
  }
  
  query += ` ORDER BY logDate ASC, startTime ASC`;
  
  const timeline = db.prepare(query).all(...params) as LifeLog[];
  
  const totalsByCategory: Record<string, number> = {};
  let totalMinutes = 0;
  let focusedMinutes = 0;
  let breakMinutes = 0;
  let entertainmentMinutes = 0;
  let wakeUpTime: string | null = null;
  
  for (const row of timeline) {
    if (row.durationMinutes) {
      totalsByCategory[row.category] = (totalsByCategory[row.category] || 0) + row.durationMinutes;
      totalMinutes += row.durationMinutes;
      
      if (row.category === "study" || row.category === "development" || row.category === "work") {
        focusedMinutes += row.durationMinutes;
      }
      
      if (row.category === "break") {
        breakMinutes += row.durationMinutes;
      }
      
      if (row.category === "entertainment") {
        entertainmentMinutes += row.durationMinutes;
      }
    }
    
    if (!wakeUpTime && /wake|woke/i.test(row.description)) {
      wakeUpTime = row.startTime;
    }
  }

  // To match the interface heartbeat expects: it wants to see if there's an open session.
  // In the SQLite version, open sessions might just be logs with no endTime, or we could just say null for now unless we implement "open sessions" in SQLite natively.
  // For now, let's look for a log with empty endTime.
  const openSession = timeline.find(t => !t.endTime) || null;
  
  return {
    dateFrom,
    dateTo,
    timeline,
    totalsByCategory,
    totalMinutes,
    focusedMinutes,
    breakMinutes,
    entertainmentMinutes,
    wakeUpTime,
    openSession: openSession ? { activity: openSession.description, startTime: openSession.startTime } : null,
  };
}
