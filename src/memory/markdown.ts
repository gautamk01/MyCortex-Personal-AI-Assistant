import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { config } from "../config.js";
import { registerTool } from "../tools/index.js";

// ── Helpers ────────────────────────────────────────────────────

function getChatNotesDir(chatId: number): string {
  const dir = join(config.notesDir, String(chatId));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

interface NotesContextCacheEntry {
  fingerprint: string;
  titles: string[];
}

const notesContextCache = new Map<number, NotesContextCacheEntry>();

function extractNoteTitle(content: string, filename: string): string {
  const titleMatch = content.match(/^title:\s*"(.+)"/m);
  return titleMatch ? titleMatch[1] : basename(filename, ".md");
}

function buildNotesFingerprint(dir: string, files: string[]): string {
  return files
    .map((file) => `${file}:${statSync(join(dir, file)).mtimeMs}`)
    .join("|");
}

function refreshNotesContextCache(chatId: number): NotesContextCacheEntry {
  const dir = getChatNotesDir(chatId);
  const files = readdirSync(dir).filter((file) => file.endsWith(".md"));
  const fingerprint = buildNotesFingerprint(dir, files);
  const titles = files.map((file) => extractNoteTitle(readFileSync(join(dir, file), "utf-8"), file));
  const entry = { fingerprint, titles };
  notesContextCache.set(chatId, entry);
  return entry;
}

// ── Note Operations ────────────────────────────────────────────

export function saveNote(
  chatId: number,
  title: string,
  content: string,
  tags: string[] = []
): string {
  const dir = getChatNotesDir(chatId);
  const slug = slugify(title);
  const filename = `${slug}.md`;
  const filepath = join(dir, filename);

  // YAML frontmatter + content
  const frontmatter = [
    "---",
    `title: "${title}"`,
    `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    `created: "${new Date().toISOString()}"`,
    `updated: "${new Date().toISOString()}"`,
    "---",
    "",
  ].join("\n");

  writeFileSync(filepath, frontmatter + content, "utf-8");
  refreshNotesContextCache(chatId);
  return `📝 Note saved: ${filename}`;
}

export function readNote(chatId: number, title: string): string {
  const dir = getChatNotesDir(chatId);
  const slug = slugify(title);
  const filepath = join(dir, `${slug}.md`);

  if (!existsSync(filepath)) {
    // Try to find by partial match
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    const match = files.find((f) =>
      f.toLowerCase().includes(slug.toLowerCase())
    );
    if (match) {
      return readFileSync(join(dir, match), "utf-8");
    }
    return `Note not found: "${title}"`;
  }

  return readFileSync(filepath, "utf-8");
}

export function listNotes(chatId: number): string {
  const dir = getChatNotesDir(chatId);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) return "No notes saved yet.";

  const lines = ["📋 Your Notes:"];
  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf-8");
    // Extract title from frontmatter
    const titleMatch = content.match(/^title:\s*"(.+)"/m);
    const title = titleMatch ? titleMatch[1] : basename(file, ".md");
    const tagsMatch = content.match(/^tags:\s*\[(.+)\]/m);
    const tags = tagsMatch ? tagsMatch[1] : "";

    lines.push(`  • ${title} (${file})${tags ? ` [${tags}]` : ""}`);
  }

  return lines.join("\n");
}

export function searchNotes(chatId: number, query: string): string {
  const dir = getChatNotesDir(chatId);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) return "No notes to search.";

  const queryLower = query.toLowerCase();
  const results: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf-8");
    if (
      content.toLowerCase().includes(queryLower) ||
      file.toLowerCase().includes(queryLower)
    ) {
      const titleMatch = content.match(/^title:\s*"(.+)"/m);
      const title = titleMatch ? titleMatch[1] : basename(file, ".md");

      // Find matching line for context
      const lines = content.split("\n");
      const matchLine = lines.find(
        (l) =>
          l.toLowerCase().includes(queryLower) && !l.startsWith("---") && !l.startsWith("title:")
      );
      const snippet = matchLine
        ? matchLine.trim().slice(0, 100)
        : "(match in metadata)";

      results.push(`• ${title} (${file}): ${snippet}`);
    }
  }

  return results.length > 0
    ? `Found ${results.length} notes:\n${results.join("\n")}`
    : `No notes matching "${query}".`;
}

export function deleteNote(chatId: number, title: string): string {
  const dir = getChatNotesDir(chatId);
  const slug = slugify(title);
  const filepath = join(dir, `${slug}.md`);

  if (!existsSync(filepath)) {
    return `Note not found: "${title}"`;
  }

  unlinkSync(filepath);
  refreshNotesContextCache(chatId);
  return `🗑️ Note deleted: "${title}"`;
}

/**
 * Get a summary of notes for prompt injection.
 */
export function getNotesContext(chatId: number): string {
  const dir = getChatNotesDir(chatId);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return "";

  const fingerprint = buildNotesFingerprint(dir, files);
  const cached = notesContextCache.get(chatId);
  const titles = cached?.fingerprint === fingerprint
    ? cached.titles
    : refreshNotesContextCache(chatId).titles;

  return `\n## Saved Notes\n${titles.map((t) => `- ${t}`).join("\n")}`;
}

// ── Register Markdown Tools ────────────────────────────────────

export function registerMarkdownTools(): void {
  registerTool({
    name: "save_note",
    description:
      "Save a note as a Markdown file. Notes are persistent, human-readable, and git-friendly. Use for longer content like ideas, instructions, summaries.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Note title (used as filename slug, e.g. 'Project Ideas')",
        },
        content: {
          type: "string",
          description: "The note content in Markdown format",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorization",
        },
      },
      required: ["title", "content"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return saveNote(
        chatId,
        input.title as string,
        input.content as string,
        (input.tags as string[]) || []
      );
    },
  });

  registerTool({
    name: "read_notes",
    description: "Read a specific note by its title.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the note to read",
        },
      },
      required: ["title"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return readNote(chatId, input.title as string);
    },
  });

  registerTool({
    name: "list_notes",
    description: "List all saved notes for this chat.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return listNotes(chatId);
    },
  });

  registerTool({
    name: "search_notes",
    description:
      "Search through saved notes by title or content.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return searchNotes(chatId, input.query as string);
    },
  });

  registerTool({
    name: "delete_note",
    description: "Delete a saved note by its title.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the note to delete",
        },
      },
      required: ["title"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return deleteNote(chatId, input.title as string);
    },
  });
}
