import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { registerTool } from "../tools/index.js";
import { config } from "../config.js";

// ── Types ──────────────────────────────────────────────────────

interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPConfigFile {
  mcpServers: Record<string, MCPServerConfig>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: string[];
}

// ── State ──────────────────────────────────────────────────────

const connectedServers = new Map<string, ConnectedServer>();

// ── Initialize MCP Bridge ──────────────────────────────────────

export async function initMCPBridge(): Promise<void> {
  const configPath = resolve(config.mcpConfigPath);

  let configData: MCPConfigFile;
  try {
    const raw = await readFile(configPath, "utf-8");
    configData = JSON.parse(raw);
  } catch (error) {
    console.log(`ℹ️  No MCP config found at ${configPath} — MCP bridge disabled`);
    return;
  }

  if (!configData.mcpServers || Object.keys(configData.mcpServers).length === 0) {
    console.log("ℹ️  No MCP servers configured");
    return;
  }

  for (const [name, serverConfig] of Object.entries(configData.mcpServers)) {
    try {
      await connectServer(name, serverConfig);
    } catch (error) {
      console.error(
        `❌ Failed to connect MCP server "${name}":`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

async function connectServer(name: string, serverConfig: MCPServerConfig): Promise<void> {
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args ?? [],
    env: { ...process.env, ...(serverConfig.env ?? {}) } as Record<string, string>,
  });

  const client = new Client({
    name: "cortex",
    version: "0.1.0",
  });

  await client.connect(transport);

  // Discover tools
  const toolsResult = await client.listTools();
  const toolNames: string[] = [];

  for (const tool of toolsResult.tools) {
    const mcpToolName = `mcp_${name}_${tool.name}`;
    toolNames.push(mcpToolName);

    // Register each MCP tool into our tool registry
    registerTool({
      name: mcpToolName,
      description: `[MCP:${name}] ${tool.description ?? tool.name}`,
      parameters: (tool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
        required: [],
      },
      execute: async (input) => {
        try {
          const result = await client.callTool({
            name: tool.name,
            arguments: input,
          });

          // Handle different content types
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
          return JSON.stringify({
            error: `MCP tool error: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      },
    });
  }

  connectedServers.set(name, { name, client, transport, tools: toolNames });
  console.log(`🔌 MCP server "${name}" connected — ${toolNames.length} tools discovered`);
}

// ── Shutdown ───────────────────────────────────────────────────

export async function closeMCPBridge(): Promise<void> {
  for (const [name, server] of connectedServers.entries()) {
    try {
      await server.client.close();
    } catch {
      // Ignore errors during shutdown
    }
    console.log(`🔌 MCP server "${name}" disconnected`);
  }
  connectedServers.clear();
}

// ── Management Tools ───────────────────────────────────────────

registerTool({
  name: "list_mcp_servers",
  description:
    "List all connected MCP servers and their available tools.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const servers = Array.from(connectedServers.values()).map(({ name, tools }) => ({
      name,
      tools,
      toolCount: tools.length,
    }));

    return JSON.stringify({
      servers,
      totalServers: servers.length,
      totalTools: servers.reduce((sum, s) => sum + s.toolCount, 0),
    });
  },
});
