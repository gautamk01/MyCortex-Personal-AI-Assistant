import { mkdirSync } from "node:fs";
import { config } from "../config.js";
import { registerTool } from "../tools/index.js";
import {
  initDatabase,
  storeFact,
  recallFacts,
  forgetFact,
  getMemoryContext,
} from "./sqlite.js";
import { getGraphContext, registerGraphTools } from "./knowledge-graph.js";
import { getNotesContext, registerMarkdownTools } from "./markdown.js";
import { getMediaContext, registerMultimodalTools } from "./multimodal.js";
import { registerEvolutionTools } from "./evolution.js";

// ── Initialize Memory System ───────────────────────────────────

export async function initMemory(): Promise<void> {
  // Ensure directories exist
  mkdirSync(config.notesDir, { recursive: true });

  // Initialize SQLite database (creates tables if needed)
  initDatabase();

  // Register all memory tools
  registerMemoryTools();
  registerGraphTools();
  registerMultimodalTools();
  registerEvolutionTools();
  registerMarkdownTools();

  console.log("🧠 Memory system initialized");
}

// ── Unified Memory Context ─────────────────────────────────────

/**
 * Get aggregated memory context from all memory subsystems.
 * This is injected into the system prompt for each LLM call.
 */
export function getFullMemoryContext(chatId: number): string {
  const parts: string[] = [];

  const factCtx = getMemoryContext(chatId);
  if (factCtx) parts.push(factCtx);

  const graphCtx = getGraphContext(chatId);
  if (graphCtx) parts.push(graphCtx);

  const notesCtx = getNotesContext(chatId);
  if (notesCtx) parts.push(notesCtx);

  const mediaCtx = getMediaContext(chatId);
  if (mediaCtx) parts.push(mediaCtx);

  if (parts.length === 0) return "";
  return "\n\n# Your Memory (loaded from persistent storage)\n" + parts.join("\n");
}

// ── Register Tools ─────────────────────────────────────────────

function registerMemoryTools(): void {
  registerTool({
    name: "remember",
    description:
      "Store a fact, preference, or piece of information in persistent memory. Use this when the user shares personal info, preferences, or asks you to remember something.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            'Short identifier for the memory (e.g. "favorite_language", "name", "birthday")',
        },
        value: {
          type: "string",
          description: "The value to remember",
        },
        category: {
          type: "string",
          description:
            'Category for organization (e.g. "preference", "personal", "work", "project")',
          default: "general",
        },
      },
      required: ["key", "value"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      const key = input.key as string;
      const value = input.value as string;
      const category = (input.category as string) || "general";
      return storeFact(chatId, key, value, category);
    },
  });

  registerTool({
    name: "recall",
    description:
      "Search persistent memory for stored facts, preferences, or information. Use this to retrieve previously stored memories.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional search query to filter memories. Leave empty to list all.",
        },
      },
      required: [],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      const query = input.query as string | undefined;
      return recallFacts(chatId, query);
    },
  });

  registerTool({
    name: "forget",
    description:
      "Remove a specific fact from persistent memory by its key.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key of the memory to forget",
        },
      },
      required: ["key"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      const key = input.key as string;
      return forgetFact(chatId, key);
    },
  });
}
