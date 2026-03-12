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
    ON CONFLICT(chatId, key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      updatedAt = datetime('now')
`);

stmt.run(1, "test", "val", "cat");
console.log("Success");
