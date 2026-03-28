import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createConnection } from "node:net";
import { exec } from "node:child_process";
import { registerTool } from "./index.js";

// ── BrowserOS Lazy On-Demand Integration ───────────────────────
// Launches and connects to BrowserOS only when a browser tool is
// actually called. No auto-start at server boot.

export const BROWSEROS_PORT = 9000;
const BROWSEROS_MCP_URL = "http://127.0.0.1:9000/mcp";
const BROWSEROS_BIN = "/home/gautam/.local/bin/BrowserOS.AppImage";
const LAUNCH_TIMEOUT_MS = 15_000;
const FOCUS_CMD =
  "xdotool search --name 'BrowserOS' windowactivate 2>/dev/null || " +
  "xdotool search --class 'browseros' windowactivate 2>/dev/null || " +
  "xdotool search --class 'Chromium' windowactivate 2>/dev/null || true";

// ── State ──────────────────────────────────────────────────────

let mcpClient: Client | null = null;
let mcpTransport: StdioClientTransport | null = null;
interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
const discoveredTools = new Map<string, DiscoveredTool>();

// ── Helpers ────────────────────────────────────────────────────

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, "127.0.0.1");
    socket.setTimeout(1500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { resolve(false); });
  });
}

export async function launchBrowserOS(): Promise<void> {
  const open = await isPortOpen(BROWSEROS_PORT);
  if (open) return; // Already running

  console.log("🚀 Launching BrowserOS...");
  exec(`${BROWSEROS_BIN} --no-sandbox`, (err) => {
    if (err) console.error("⚠️  BrowserOS launch error:", err.message);
  });

  // Wait for port to become available
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isPortOpen(BROWSEROS_PORT)) {
      // Port is open, but the MCP HTTP endpoint needs more time to initialize.
      // Wait for the app to fully boot before attempting MCP connection.
      console.log("⏳ Port open — waiting for BrowserOS MCP to initialize...");
      await new Promise((r) => setTimeout(r, 5000));
      console.log("✅ BrowserOS is ready on port", BROWSEROS_PORT);
      return;
    }
  }
  throw new Error(
    `BrowserOS did not start within ${LAUNCH_TIMEOUT_MS / 1000}s. ` +
    `Make sure ${BROWSEROS_BIN} exists and is executable.`
  );
}

export function focusBrowserOS(): void {
  exec(FOCUS_CMD, () => {}); // fire-and-forget
}

async function connectMCP(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "mcp-remote", BROWSEROS_MCP_URL],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client({ name: "cortex-browseros", version: "0.1.0" });
  await client.connect(transport);

  mcpTransport = transport;
  return client;
}

async function ensureConnected(): Promise<Client> {
  // If we already have a live client, reuse it
  if (mcpClient) {
    return mcpClient;
  }

  // 1. Launch BrowserOS if not running
  await launchBrowserOS();

  // 2. Connect MCP client with retries (BrowserOS MCP can take time to be ready)
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🔌 Connecting to BrowserOS MCP... (attempt ${attempt}/${MAX_RETRIES})`);
      mcpClient = await connectMCP();
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  MCP connect attempt ${attempt} failed: ${msg}`);

      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Could not connect to BrowserOS MCP after ${MAX_RETRIES} attempts. ` +
          `Last error: ${msg}`
        );
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  // 3. Discover tools
  const result = await mcpClient!.listTools();
  discoveredTools.clear();
  for (const tool of result.tools) {
    discoveredTools.set(tool.name, {
      name: tool.name,
      description: (tool.description as string) ?? tool.name,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    });
  }

  console.log(
    `🌐 BrowserOS MCP connected — ${discoveredTools.size} tools: ` +
    Array.from(discoveredTools.keys()).join(", ")
  );

  return mcpClient!;
}

export async function callBrowserOSTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const client = await ensureConnected();
  focusBrowserOS();

  // Find the tool (exact match or partial)
  let actualName = toolName;
  if (!discoveredTools.has(toolName)) {
    // Try partial match
    for (const [name] of discoveredTools) {
      if (name.toLowerCase().includes(toolName.toLowerCase()) ||
          toolName.toLowerCase().includes(name.toLowerCase())) {
        actualName = name;
        break;
      }
    }
  }

  if (!discoveredTools.has(actualName)) {
    return JSON.stringify({
      error: `Unknown BrowserOS tool: "${toolName}". Available tools: ${Array.from(discoveredTools.keys()).join(", ")}`,
    });
  }

  try {
    const result = await client.callTool({ name: actualName, arguments: args });

    if (Array.isArray(result.content)) {
      return result.content
        .map((c: { type: string; text?: string }) =>
          c.type === "text" ? c.text : JSON.stringify(c)
        )
        .join("\n");
    }
    return typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isConnectionDead =
      msg.includes("Connection closed") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ECONNRESET") ||
      msg.includes("socket hang up");

    if (isConnectionDead) {
      // Connection is truly dead — reset so next call reconnects
      console.warn("🔌 BrowserOS MCP connection lost — will reconnect on next call");
      mcpClient = null;
      mcpTransport = null;
    }

    return JSON.stringify({
      error: `BrowserOS tool error: ${msg}`,
    });
  }
}

// ── Shutdown ───────────────────────────────────────────────────

export async function closeBrowserOS(): Promise<void> {
  if (mcpClient) {
    try { await mcpClient.close(); } catch { /* ignore */ }
    mcpClient = null;
    mcpTransport = null;
    discoveredTools.clear();
    console.log("🌐 BrowserOS MCP disconnected");
  }
}

// ── Registered Tools ───────────────────────────────────────────

registerTool({
  name: "browseros_list_tools",
  description:
    "Launch BrowserOS (if not running), connect to it, and list all available " +
    "browser automation tools. Call this FIRST before using browseros_run, " +
    "so you know the exact tool names and their parameters.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    try {
      await ensureConnected();
      focusBrowserOS();

      const tools = Array.from(discoveredTools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }));

      return JSON.stringify({
        status: "connected",
        toolCount: tools.length,
        tools,
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to connect to BrowserOS: ${error instanceof Error ? error.message : String(error)}`,
        hint: "Make sure BrowserOS.AppImage is installed at /home/gautam/.local/bin/BrowserOS.AppImage",
      });
    }
  },
});

registerTool({
  name: "browseros_run",
  description:
    "Execute a specific tool in BrowserOS. BrowserOS will be launched and " +
    "brought to the front automatically. You MUST call browseros_list_tools " +
    "first to discover the exact tool names and parameter schemas. " +
    "Then call this tool with the tool_name and arguments.",
  parameters: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description:
          "The exact BrowserOS MCP tool name to execute (from browseros_list_tools)",
      },
      arguments: {
        type: "object",
        description:
          "The arguments object to pass to the BrowserOS tool, matching its parameter schema",
      },
    },
    required: ["tool_name", "arguments"],
  },
  execute: async (input) => {
    const toolName = input.tool_name as string;
    const args = (input.arguments as Record<string, unknown>) ?? {};

    if (!toolName) {
      return JSON.stringify({
        error: "Missing tool_name. Call browseros_list_tools first to see available tools.",
      });
    }

    return callBrowserOSTool(toolName, args);
  },
});
