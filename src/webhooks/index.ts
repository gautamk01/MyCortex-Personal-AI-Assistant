import express from "express";
import { v4 as uuidv4 } from "uuid";
import { registerTool } from "../tools/index.js";
import { config } from "../config.js";

// ── Types ──────────────────────────────────────────────────────

interface WebhookEndpoint {
  id: string;
  name: string;
  path: string;
  chatId: number;
  secret: string | null;
  createdAt: string;
}

// ── In-memory webhook store ────────────────────────────────────

const webhooks = new Map<string, WebhookEndpoint>();

// ── Callback for incoming webhook payloads ─────────────────────

type WebhookCallback = (chatId: number, message: string) => Promise<void>;
let onWebhookReceived: WebhookCallback | null = null;

export function setWebhookCallback(cb: WebhookCallback): void {
  onWebhookReceived = cb;
}

// ── Express server ─────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let server: ReturnType<typeof app.listen> | null = null;

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", webhooks: webhooks.size });
});

// Dynamic webhook handler
app.all("/webhook/:id", async (req, res) => {
  const webhook = webhooks.get(req.params.id);

  if (!webhook) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }

  // Check secret if configured
  if (webhook.secret) {
    const provided =
      req.headers["x-webhook-secret"] ?? req.query.secret;
    if (provided !== webhook.secret) {
      res.status(401).json({ error: "Invalid secret" });
      return;
    }
  }

  const payload = {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).filter(
        ([k]) => !["host", "connection", "content-length"].includes(k)
      )
    ),
    query: req.query,
    body: req.body,
    timestamp: new Date().toISOString(),
  };

  console.log(`🪝 Webhook "${webhook.name}" (${webhook.id}) received ${req.method} request`);

  // Route to agent
  if (onWebhookReceived) {
    const message = `[Webhook "${webhook.name}" triggered]\nPayload: ${JSON.stringify(payload, null, 2).slice(0, 2000)}`;
    await onWebhookReceived(webhook.chatId, message).catch((err) =>
      console.error(`❌ Webhook callback error:`, err)
    );
  }

  res.json({ received: true, webhookId: webhook.id });
});

// ── Start / Stop ───────────────────────────────────────────────

export function startWebhookServer(): void {
  const port = config.webhookPort;
  server = app.listen(port, () => {
    console.log(`🪝 Webhook server listening on port ${port}`);
  });
}

export function stopWebhookServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}

// ── Tools ──────────────────────────────────────────────────────

registerTool({
  name: "create_webhook",
  description:
    "Create a webhook endpoint that listens for incoming HTTP requests. " +
    "When the webhook receives a request, the payload is sent to the current chat. " +
    "Returns the webhook URL for external services.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable name for this webhook" },
      chat_id: {
        type: "number",
        description: "Telegram chat ID to route webhook payloads to",
      },
      use_secret: {
        type: "boolean",
        description: "If true, generate a secret token for authentication (default: false)",
      },
    },
    required: ["name", "chat_id"],
  },
  execute: async (input) => {
    const name = input.name as string;
    const chatId = input.chat_id as number;
    const useSecret = (input.use_secret as boolean) ?? false;

    const id = uuidv4().slice(0, 8);
    const secret = useSecret ? uuidv4() : null;

    const webhook: WebhookEndpoint = {
      id,
      name,
      path: `/webhook/${id}`,
      chatId,
      secret,
      createdAt: new Date().toISOString(),
    };

    webhooks.set(id, webhook);

    const baseUrl = `http://localhost:${config.webhookPort}`;
    return JSON.stringify({
      success: true,
      id,
      name,
      url: `${baseUrl}/webhook/${id}`,
      secret: secret ?? undefined,
      message: `Webhook "${name}" created. Send requests to ${baseUrl}/webhook/${id}`,
    });
  },
});

registerTool({
  name: "list_webhooks",
  description: "List all active webhook endpoints.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const baseUrl = `http://localhost:${config.webhookPort}`;
    const list = Array.from(webhooks.values()).map(
      ({ id, name, path, chatId, secret, createdAt }) => ({
        id,
        name,
        url: `${baseUrl}${path}`,
        chatId,
        hasSecret: !!secret,
        createdAt,
      })
    );
    return JSON.stringify({ webhooks: list, count: list.length });
  },
});

registerTool({
  name: "delete_webhook",
  description: "Delete a webhook endpoint by its ID.",
  parameters: {
    type: "object",
    properties: {
      webhook_id: { type: "string", description: "The webhook ID to delete" },
    },
    required: ["webhook_id"],
  },
  execute: async (input) => {
    const id = input.webhook_id as string;
    const webhook = webhooks.get(id);
    if (!webhook) return JSON.stringify({ error: `Webhook "${id}" not found` });

    webhooks.delete(id);
    return JSON.stringify({ success: true, id, name: webhook.name, status: "deleted" });
  },
});
