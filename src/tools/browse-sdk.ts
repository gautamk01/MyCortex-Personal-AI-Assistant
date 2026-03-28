import { Agent, ConnectionError } from "@browseros-ai/agent-sdk";
import type { UIMessageStreamEvent } from "@browseros-ai/agent-sdk";
import { registerTool } from "./index.js";
import {
  launchBrowserOS,
  BROWSEROS_PORT,
  focusBrowserOS,
  callBrowserOSTool,
} from "./browseros.js";

// ── BrowserOS Agent SDK Integration ──────────────────────────
// High-level natural language browser automation on top of the
// existing BrowserOS instance. Uses the /sdk/* HTTP endpoints
// and MCP tools for low-level operations (screenshot, PDF, etc.).
// LLM config is NOT passed — BrowserOS uses its own configured LLM.

// ── Timeout Helper ───────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Browser task timed out after ${ms / 1000}s`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// ── Progress Logger ──────────────────────────────────────────

function logProgress(event: UIMessageStreamEvent): void {
  switch (event.type) {
    case "start-step":
      console.log("🧠 [BrowserOS] ── New step ──");
      break;
    case "text-delta":
      process.stdout.write(event.delta);
      break;
    case "text-end":
      process.stdout.write("\n");
      break;
    case "reasoning-delta":
      process.stdout.write((event as Record<string, string>).delta ?? "");
      break;
    case "reasoning-end":
      process.stdout.write("\n");
      break;
    case "tool-input-available":
      console.log(`🔧 [BrowserOS] Tool: ${event.toolName}(${JSON.stringify(event.input)})`);
      break;
    case "tool-output-available":
      console.log(
        `✅ [BrowserOS] Result: ${
          typeof event.output === "string"
            ? event.output.slice(0, 200)
            : JSON.stringify(event.output).slice(0, 200)
        }`,
      );
      break;
    case "finish-step":
      console.log("🧠 [BrowserOS] ── Step done ──");
      break;
    case "error":
      console.error(
        "❌ [BrowserOS] Error:",
        (event as Record<string, unknown>).message ?? event,
      );
      break;
  }
}

// ── Singleton Agent (concurrency-safe) ───────────────────────

let sdkAgent: Agent | null = null;
let sdkAgentPromise: Promise<Agent> | null = null;

async function ensureAgent(): Promise<Agent> {
  if (sdkAgent) return sdkAgent;

  if (!sdkAgentPromise) {
    sdkAgentPromise = (async () => {
      await launchBrowserOS();
      sdkAgent = new Agent({
        url: `http://127.0.0.1:${BROWSEROS_PORT}`,
        stateful: true,
        onProgress: logProgress,
      });
      console.log("🌐 BrowserOS Agent SDK connected");
      return sdkAgent;
    })().finally(() => {
      sdkAgentPromise = null;
    });
  }

  return sdkAgentPromise;
}

// ── Shutdown ─────────────────────────────────────────────────

export async function closeSDKAgent(): Promise<void> {
  if (sdkAgent) {
    try {
      await sdkAgent.dispose();
    } catch {
      /* ignore */
    }
    sdkAgent = null;
    console.log("🌐 BrowserOS Agent SDK disconnected");
  }
}

// ── Error Handler ────────────────────────────────────────────

function handleSDKError(error: unknown): string {
  const isConnectionDead =
    error instanceof ConnectionError ||
    (error instanceof TypeError && error.message.includes("fetch")) ||
    (error instanceof Error &&
      (error.message.includes("ECONNREFUSED") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("socket hang up")));

  if (isConnectionDead) {
    sdkAgent = null;
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      error: `BrowserOS connection lost: ${msg}`,
      hint: "The agent will reconnect automatically on the next call.",
    });
  }

  const msg = error instanceof Error ? error.message : String(error);
  return JSON.stringify({ error: `Browser action failed: ${msg}` });
}

// ── Helper: navigate if URL provided ─────────────────────────

async function maybeNavigate(
  agent: Agent,
  url: string | undefined,
): Promise<string | null> {
  if (!url) return null;
  const navResult = await agent.nav(url);
  if (!navResult.success) {
    return JSON.stringify({ success: false, error: `Navigation to ${url} failed` });
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// SDK Tools (high-level natural language)
// ═══════════════════════════════════════════════════════════════

// ── Tool: browse ─────────────────────────────────────────────

registerTool({
  name: "browse",
  description:
    "Perform a browser action described in natural language. BrowserOS launches " +
    "automatically and is visible on screen. Optionally navigate to a URL first. " +
    "Use this for ALL browser tasks: searching, clicking, filling forms, reading pages. " +
    "Supports optional post-action verification and context interpolation with {{key}} syntax.",
  parameters: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description:
          "Natural language description of the browser action to perform. " +
          "Supports {{key}} template syntax when context is provided.",
      },
      url: {
        type: "string",
        description: "Optional URL to navigate to before performing the action",
      },
      context: {
        type: "object",
        description:
          "Optional key-value pairs for template interpolation. " +
          'E.g. context: {query: "shoes"} with instruction "search for {{query}}"',
      },
      verify: {
        type: "string",
        description:
          "Optional assertion to verify after the action (e.g. 'Cart shows 1 item')",
      },
      max_steps: {
        type: "number",
        description: "Maximum steps for multi-step actions (default: 10)",
      },
    },
    required: ["instruction"],
  },
  execute: async (input) => {
    const instruction = input.instruction as string;
    const url = input.url as string | undefined;
    const context = input.context as Record<string, unknown> | undefined;
    const verifyStr = input.verify as string | undefined;
    const maxSteps = input.max_steps as number | undefined;

    try {
      const agent = await ensureAgent();
      focusBrowserOS();

      const navError = await maybeNavigate(agent, url);
      if (navError) return navError;

      const result = await withTimeout(
        agent.act(instruction, {
          maxSteps: maxSteps ?? 10,
          context,
          verify: verifyStr,
          maxRetries: verifyStr ? 2 : undefined,
        }),
      );

      return JSON.stringify({
        success: result.success,
        steps: result.steps.length,
        details: result.steps.map((s) => ({
          thought: s.thought,
          actions: s.toolCalls?.map((tc) => tc.name) ?? [],
        })),
      });
    } catch (error) {
      return handleSDKError(error);
    }
  },
});

// ── Tool: browse_extract ─────────────────────────────────────

registerTool({
  name: "browse_extract",
  description:
    "Extract structured data from the current browser page. Provide a natural language " +
    "instruction and a JSON Schema describing the expected output shape. The browser must " +
    "already be on the target page (use 'browse' to navigate first).",
  parameters: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description:
          "What data to extract (e.g. 'get all product names and prices')",
      },
      schema: {
        type: "object",
        description: "JSON Schema describing the expected output structure",
      },
    },
    required: ["instruction", "schema"],
  },
  execute: async (input) => {
    const instruction = input.instruction as string;
    const schema = input.schema as Record<string, unknown>;

    try {
      await ensureAgent();
      focusBrowserOS();

      const response = await withTimeout(
        fetch(`http://127.0.0.1:${BROWSEROS_PORT}/sdk/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, schema }),
        }),
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const errMsg =
          (errBody as Record<string, Record<string, string>>)?.error?.message ??
          "Unknown error";
        return JSON.stringify({
          error: `Extraction failed (${response.status}): ${errMsg}`,
        });
      }

      const result = await response.json();
      return JSON.stringify({
        success: true,
        data: (result as Record<string, unknown>).data,
      });
    } catch (error) {
      return handleSDKError(error);
    }
  },
});

// ── Tool: browse_verify ──────────────────────────────────────

registerTool({
  name: "browse_verify",
  description:
    "Verify that the current browser page matches an expected state. " +
    "Returns whether the verification passed and an explanation.",
  parameters: {
    type: "object",
    properties: {
      expectation: {
        type: "string",
        description:
          "Expected page state (e.g. 'login form is visible', 'cart has 3 items')",
      },
    },
    required: ["expectation"],
  },
  execute: async (input) => {
    const expectation = input.expectation as string;

    try {
      const agent = await ensureAgent();
      focusBrowserOS();

      const result = await withTimeout(agent.verify(expectation));
      return JSON.stringify(result);
    } catch (error) {
      return handleSDKError(error);
    }
  },
});

// ═══════════════════════════════════════════════════════════════
// MCP Power Tools (direct browser operations)
// ═══════════════════════════════════════════════════════════════

// ── Tool: browse_screenshot ──────────────────────────────────

registerTool({
  name: "browse_screenshot",
  description:
    "Take a screenshot of the current browser page. Optionally navigate to a URL first. " +
    "Returns the screenshot as base64 image data. Use when the user wants to SEE what a " +
    "page looks like or you need visual confirmation.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Optional URL to navigate to before taking the screenshot",
      },
      full_page: {
        type: "boolean",
        description:
          "Capture the full scrollable page instead of just the viewport (default: false)",
      },
    },
  },
  execute: async (input) => {
    const url = input.url as string | undefined;
    const fullPage = (input.full_page as boolean) ?? false;

    try {
      const agent = await ensureAgent();
      focusBrowserOS();

      const navError = await maybeNavigate(agent, url);
      if (navError) return navError;

      const result = await withTimeout(
        callBrowserOSTool("take_screenshot", {
          page: 1,
          fullPage,
        }),
      );

      return result;
    } catch (error) {
      return handleSDKError(error);
    }
  },
});

// ── Tool: browse_read_page ───────────────────────────────────

registerTool({
  name: "browse_read_page",
  description:
    "Get the text content of the current browser page as clean readable markdown. " +
    "Includes headers, lists, tables, and links. Navigate to a URL first if provided. " +
    "Use this to read articles, documentation, search results, or any page content.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Optional URL to navigate to before reading",
      },
    },
  },
  execute: async (input) => {
    const url = input.url as string | undefined;

    try {
      const agent = await ensureAgent();
      focusBrowserOS();

      const navError = await maybeNavigate(agent, url);
      if (navError) return navError;

      const result = await withTimeout(
        callBrowserOSTool("get_page_content", { page: 1 }),
      );

      return result;
    } catch (error) {
      return handleSDKError(error);
    }
  },
});

// ── Tool: browse_save_pdf ────────────────────────────────────

registerTool({
  name: "browse_save_pdf",
  description:
    "Export the current browser page as a PDF file. Optionally navigate to a URL first. " +
    "Use for saving receipts, articles, research papers, or any page as a document.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Optional URL to navigate to before saving",
      },
      filename: {
        type: "string",
        description: "Optional filename for the PDF (default: page title)",
      },
    },
  },
  execute: async (input) => {
    const url = input.url as string | undefined;
    const filename = input.filename as string | undefined;

    try {
      const agent = await ensureAgent();
      focusBrowserOS();

      const navError = await maybeNavigate(agent, url);
      if (navError) return navError;

      const args: Record<string, unknown> = { page: 1 };
      if (filename) args.filename = filename;

      const result = await withTimeout(callBrowserOSTool("save_pdf", args));

      return result;
    } catch (error) {
      return handleSDKError(error);
    }
  },
});

// ── Tool: browse_run_js ──────────────────────────────────────

registerTool({
  name: "browse_run_js",
  description:
    "Execute JavaScript code on the current browser page and return the result. " +
    "Use for counting elements, extracting specific data, checking page state, " +
    "or any custom page manipulation. The code runs in the page context.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "JavaScript code to execute. Must return a JSON-serializable value. " +
          "Example: \"document.querySelectorAll('img').length\"",
      },
      url: {
        type: "string",
        description: "Optional URL to navigate to before executing the script",
      },
    },
    required: ["code"],
  },
  execute: async (input) => {
    const code = input.code as string;
    const url = input.url as string | undefined;

    try {
      const agent = await ensureAgent();
      focusBrowserOS();

      const navError = await maybeNavigate(agent, url);
      if (navError) return navError;

      const result = await withTimeout(
        callBrowserOSTool("evaluate_script", {
          page: 1,
          script: code,
        }),
      );

      return result;
    } catch (error) {
      return handleSDKError(error);
    }
  },
});

// ── Tool: browse_tabs ────────────────────────────────────────

registerTool({
  name: "browse_tabs",
  description:
    "Manage browser tabs: list all open tabs, open a new tab with a URL, or close a tab. " +
    "Use for multi-tab workflows like comparing pages or working on multiple sites.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "open", "close"],
        description: "Action to perform: list open tabs, open a new tab, or close a tab",
      },
      url: {
        type: "string",
        description: "URL to open (required when action is 'open')",
      },
      tab_id: {
        type: "number",
        description: "Tab ID to close (required when action is 'close')",
      },
    },
    required: ["action"],
  },
  execute: async (input) => {
    const action = input.action as string;
    const url = input.url as string | undefined;
    const tabId = input.tab_id as number | undefined;

    try {
      await ensureAgent();
      focusBrowserOS();

      switch (action) {
        case "list": {
          const result = await withTimeout(callBrowserOSTool("list_pages", {}));
          return result;
        }
        case "open": {
          if (!url) {
            return JSON.stringify({ error: "URL is required when action is 'open'" });
          }
          const result = await withTimeout(
            callBrowserOSTool("new_page", { url }),
          );
          return result;
        }
        case "close": {
          if (tabId === undefined) {
            return JSON.stringify({
              error: "tab_id is required when action is 'close'. Use action 'list' first to see tab IDs.",
            });
          }
          const result = await withTimeout(
            callBrowserOSTool("close_page", { page: tabId }),
          );
          return result;
        }
        default:
          return JSON.stringify({
            error: `Unknown action: ${action}. Use 'list', 'open', or 'close'.`,
          });
      }
    } catch (error) {
      return handleSDKError(error);
    }
  },
});
