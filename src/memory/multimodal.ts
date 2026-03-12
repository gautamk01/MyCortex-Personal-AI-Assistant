import { getDb } from "./sqlite.js";
import { registerTool } from "../tools/index.js";

// ── Store Media Memory ─────────────────────────────────────────

export function storeMediaMemory(
  chatId: number,
  mediaType: string,
  filename: string,
  description: string,
  tags: string[] = []
): string {
  const stmt = getDb().prepare(`
    INSERT INTO media_memories (chatId, mediaType, filename, description, tags)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(chatId, mediaType, filename, description, JSON.stringify(tags));
  return `Media memory stored: [${mediaType}] ${filename} — "${description}"`;
}

// ── Search Media ───────────────────────────────────────────────

export function searchMedia(chatId: number, query: string): string {
  const pattern = `%${query}%`;
  const rows = getDb()
    .prepare(
      `SELECT mediaType, filename, description, tags, createdAt
       FROM media_memories
       WHERE chatId = ? AND (description LIKE ? OR filename LIKE ? OR tags LIKE ?)
       ORDER BY createdAt DESC LIMIT 15`
    )
    .all(chatId, pattern, pattern, pattern) as Array<{
    mediaType: string;
    filename: string;
    description: string;
    tags: string;
    createdAt: string;
  }>;

  if (rows.length === 0) return `No media memories matching "${query}".`;

  return rows
    .map(
      (r) =>
        `[${r.mediaType}] ${r.filename}: ${r.description} (tags: ${r.tags}, ${r.createdAt})`
    )
    .join("\n");
}

// ── Media Context for Prompt ───────────────────────────────────

/**
 * Get a brief summary of recent media memories for prompt injection.
 */
export function getMediaContext(chatId: number): string {
  const rows = getDb()
    .prepare(
      `SELECT mediaType, filename, description
       FROM media_memories
       WHERE chatId = ?
       ORDER BY createdAt DESC LIMIT 5`
    )
    .all(chatId) as Array<{
    mediaType: string;
    filename: string;
    description: string;
  }>;

  if (rows.length === 0) return "";

  const lines = ["\n## Recent Media Memories"];
  for (const r of rows) {
    lines.push(`- [${r.mediaType}] ${r.filename}: ${r.description}`);
  }
  return lines.join("\n");
}

// ── Register Multimodal Tools ──────────────────────────────────

export function registerMultimodalTools(): void {
  registerTool({
    name: "store_media_memory",
    description:
      "Store metadata about a media file (image, audio, video, document) in memory. Use after processing/extracting information from media.",
    parameters: {
      type: "object",
      properties: {
        media_type: {
          type: "string",
          description: 'Type of media: "image", "audio", "video", "document"',
          enum: ["image", "audio", "video", "document"],
        },
        filename: {
          type: "string",
          description: "The filename or path of the media",
        },
        description: {
          type: "string",
          description:
            "Description or extracted content from the media",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
      },
      required: ["media_type", "filename", "description"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return storeMediaMemory(
        chatId,
        input.media_type as string,
        input.filename as string,
        input.description as string,
        (input.tags as string[]) || []
      );
    },
  });

  registerTool({
    name: "search_media",
    description:
      "Search stored media memories by description, filename, or tags.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for media memories",
        },
      },
      required: ["query"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return searchMedia(chatId, input.query as string);
    },
  });
}
