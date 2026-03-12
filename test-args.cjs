const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId      INTEGER NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      category    TEXT DEFAULT 'general',
      updatedAt   TEXT DEFAULT (datetime('now')),
      UNIQUE(chatId, key)
    )
`);

const stmt = db.prepare(`
    INSERT INTO facts (chatId, key, value, category, updatedAt)
    VALUES (?, ?, ?, ?, datetime('now'))
`);

try {
  stmt.run(1, "test", ["an", "array"], "cat");
} catch (e) {
  console.log("Array value:", e.name, e.message);
}

try {
  stmt.run([1, "test", "val", "cat", "extra"]);
} catch (e) {
  console.log("Array as first arg:", e.name, e.message);
}

