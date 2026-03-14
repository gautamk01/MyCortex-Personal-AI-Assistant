import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ── Tool Definition Type ───────────────────────────────────────

export interface ToolDefinition {
  /** Tool name (must match function call name) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for the tool's input parameters */
  parameters: Record<string, unknown>;
  /** Execute the tool and return a string result */
  execute: (input: Record<string, unknown>) => Promise<string>;
}

// ── Tool Registry ──────────────────────────────────────────────

const registry = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.name)) {
    console.warn(`⚠️  Tool "${tool.name}" already registered — skipping duplicate.`);
    return;
  }
  registry.set(tool.name, tool);
}

/**
 * Get all tool schemas in OpenAI function-calling format.
 */
export function getToolDefinitions(): ChatCompletionTool[] {
  return Array.from(registry.values()).map(({ name, description, parameters }) => ({
    type: "function" as const,
    function: {
      name,
      description,
      parameters,
    },
  }));
}

/**
 * Execute a tool by name with the given input.
 * Returns the string result or throws if the tool is unknown.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const tool = registry.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: "${name}"`);
  }
  return tool.execute(input);
}

// ── Load all tools ─────────────────────────────────────────────
// Dynamic import to avoid circular initialization issues.
// Each tool file calls registerTool() on load.

export async function loadTools(): Promise<void> {
  await import("./get-current-time.js");
  await import("./shell.js");
  await import("./file-ops.js");
  await import("./browser.js");
  await import("./web-search.js");
  await import("./terminal.js");
  await import("./desktop.js");
  await import("./codex.js");
  await import("./daily-plan-tools.js");
  await import("./gamification-tools.js");
  await import("./reminders-tools.js");
  await import("./coach-tools.js");
}
