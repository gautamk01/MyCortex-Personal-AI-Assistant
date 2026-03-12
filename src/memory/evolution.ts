import { getDb } from "./sqlite.js";
import { config } from "../config.js";
import { registerTool } from "../tools/index.js";

// ── Access Tracking ────────────────────────────────────────────

export function trackAccess(factId: number): void {
  getDb()
    .prepare(
      "UPDATE facts SET accessCount = accessCount + 1, lastAccessed = datetime('now') WHERE id = ?"
    )
    .run(factId);
  getDb()
    .prepare("INSERT INTO access_log (factId) VALUES (?)")
    .run(factId);
}

// ── Memory Decay ───────────────────────────────────────────────

/**
 * Reduce importance of memories not accessed within the decay period.
 * Memories with 0 access in the decay window lose importance gradually.
 * Once importance drops below 0.1, they are auto-deleted.
 */
export function decayMemories(): string {
  const decayDays = config.memoryDecayDays;

  // Reduce importance of old, unused memories
  const decayed = getDb()
    .prepare(
      `UPDATE facts SET importance = importance * 0.8
       WHERE lastAccessed < datetime('now', ? || ' days')
       AND importance > 0.1`
    )
    .run(`-${decayDays}`);

  // Auto-delete memories that have fully decayed
  const deleted = getDb()
    .prepare("DELETE FROM facts WHERE importance <= 0.1 AND accessCount = 0")
    .run();

  return `Decay cycle: ${decayed.changes} memories reduced, ${deleted.changes} expired memories removed.`;
}

// ── Merge Duplicates ───────────────────────────────────────────

/**
 * Find facts with very similar keys and merge them.
 * Uses simple string similarity (common prefix matching).
 */
export function mergeDuplicates(chatId: number): string {
  const facts = getDb()
    .prepare(
      "SELECT id, key, value, category, accessCount FROM facts WHERE chatId = ? ORDER BY key"
    )
    .all(chatId) as Array<{
    id: number;
    key: string;
    value: string;
    category: string;
    accessCount: number;
  }>;

  let mergeCount = 0;
  const toDelete: number[] = [];

  for (let i = 0; i < facts.length - 1; i++) {
    if (toDelete.includes(facts[i].id)) continue;

    for (let j = i + 1; j < facts.length; j++) {
      if (toDelete.includes(facts[j].id)) continue;

      // Check if keys are very similar (e.g. "fav_color" vs "favorite_color")
      if (areSimilarKeys(facts[i].key, facts[j].key)) {
        // Keep the one with more accesses, merge values
        const keeper = facts[i].accessCount >= facts[j].accessCount ? facts[i] : facts[j];
        const merged = facts[i].accessCount >= facts[j].accessCount ? facts[j] : facts[i];

        // If values differ, append the merged value
        if (keeper.value !== merged.value) {
          getDb()
            .prepare("UPDATE facts SET value = ?, updatedAt = datetime('now') WHERE id = ?")
            .run(`${keeper.value} (also: ${merged.value})`, keeper.id);
        }

        toDelete.push(merged.id);
        mergeCount++;
      }
    }
  }

  // Delete merged duplicates
  for (const id of toDelete) {
    getDb().prepare("DELETE FROM facts WHERE id = ?").run(id);
  }

  return mergeCount > 0
    ? `Merged ${mergeCount} duplicate memories.`
    : "No duplicate memories found.";
}

// ── Memory Stats ───────────────────────────────────────────────

export function getMemoryStats(chatId: number): string {
  const factCount = (
    getDb()
      .prepare("SELECT COUNT(*) as count FROM facts WHERE chatId = ?")
      .get(chatId) as { count: number }
  ).count;

  const entityCount = (
    getDb()
      .prepare("SELECT COUNT(*) as count FROM entities WHERE chatId = ?")
      .get(chatId) as { count: number }
  ).count;

  const relationCount = (
    getDb()
      .prepare("SELECT COUNT(*) as count FROM relations WHERE chatId = ?")
      .get(chatId) as { count: number }
  ).count;

  const mediaCount = (
    getDb()
      .prepare("SELECT COUNT(*) as count FROM media_memories WHERE chatId = ?")
      .get(chatId) as { count: number }
  ).count;

  const mostAccessed = getDb()
    .prepare(
      "SELECT key, value, accessCount FROM facts WHERE chatId = ? ORDER BY accessCount DESC LIMIT 3"
    )
    .all(chatId) as Array<{ key: string; value: string; accessCount: number }>;

  const leastAccessed = getDb()
    .prepare(
      "SELECT key, value, accessCount, importance FROM facts WHERE chatId = ? ORDER BY accessCount ASC, importance ASC LIMIT 3"
    )
    .all(chatId) as Array<{
    key: string;
    value: string;
    accessCount: number;
    importance: number;
  }>;

  const lines = [
    `📊 Memory Statistics`,
    `───────────────────`,
    `Facts:     ${factCount}`,
    `Entities:  ${entityCount}`,
    `Relations: ${relationCount}`,
    `Media:     ${mediaCount}`,
  ];

  if (mostAccessed.length > 0) {
    lines.push(`\nMost accessed:`);
    for (const f of mostAccessed) {
      lines.push(`  • ${f.key}: ${f.accessCount} accesses`);
    }
  }

  if (leastAccessed.length > 0) {
    lines.push(`\nLeast accessed (may decay):`);
    for (const f of leastAccessed) {
      lines.push(
        `  • ${f.key}: ${f.accessCount} accesses, importance: ${f.importance.toFixed(2)}`
      );
    }
  }

  return lines.join("\n");
}

// ── Run Maintenance ────────────────────────────────────────────

export function runMaintenance(chatId: number): string {
  const results: string[] = [];
  results.push(decayMemories());
  results.push(mergeDuplicates(chatId));
  return `🔧 Memory Maintenance Complete\n${results.join("\n")}`;
}

// ── Register Evolution Tools ───────────────────────────────────

export function registerEvolutionTools(): void {
  registerTool({
    name: "memory_stats",
    description:
      "Show statistics about stored memories: counts, most/least accessed, etc.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return getMemoryStats(chatId);
    },
  });

  registerTool({
    name: "memory_maintain",
    description:
      "Run memory maintenance: decay unused memories, merge duplicates, and reorganize.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return runMaintenance(chatId);
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Check if two keys are similar enough to be duplicates.
 * Simple heuristic: shared prefix > 60% of shorter key length,
 * or one is a substring of the other.
 */
function areSimilarKeys(a: string, b: string): boolean {
  if (a === b) return true;

  // One is substring of the other
  if (a.includes(b) || b.includes(a)) return true;

  // Normalize: remove separators
  const normA = a.replace(/[_\-\s]/g, "").toLowerCase();
  const normB = b.replace(/[_\-\s]/g, "").toLowerCase();

  if (normA === normB) return true;

  // Check shared prefix
  let shared = 0;
  const minLen = Math.min(normA.length, normB.length);
  for (let i = 0; i < minLen; i++) {
    if (normA[i] === normB[i]) shared++;
    else break;
  }

  return shared / minLen > 0.6;
}
