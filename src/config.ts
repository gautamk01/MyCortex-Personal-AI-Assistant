import "dotenv/config";
import { resolve } from "node:path";

// ── Required ───────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    console.error(`   Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
  return value;
}

function csvList(envVar: string | undefined, defaults: string[]): string[] {
  if (!envVar) return defaults;
  return envVar.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  // ── Core ───────────────────────────────────────────────────
  /** Telegram bot token from @BotFather */
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),

  /** LLM API key (optional for local Ollama) */
  llmApiKey: process.env.LLM_API_KEY ?? "ollama",

  /** LLM base URL (Ollama default: http://localhost:11434/v1) */
  llmBaseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",

  /** Allowed Telegram user IDs (whitelist) */
  allowedUserIds: requireEnv("ALLOWED_USER_IDS")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => !isNaN(id) && id > 0),

  /** LLM model to use */
  llmModel: process.env.LLM_MODEL ?? "qwen3:8b",

  /** Max agentic loop iterations (safety limit) */
  maxAgentIterations: Number(process.env.MAX_AGENT_ITERATIONS) || 10,

  /** Kokoro TTS server URL (optional — voice is disabled if empty) */
  kokoroUrl: process.env.KOKORO_URL ?? "http://127.0.0.1:8880",

  /** Kokoro voice ID */
  kokoroVoice: process.env.KOKORO_VOICE ?? "af_heart",

  // ── Shell Commands ─────────────────────────────────────────
  /** Allowlisted shell commands */
  shellAllowedCommands: csvList(process.env.SHELL_ALLOWED_COMMANDS, [
    "ls", "cat", "echo", "date", "whoami", "hostname", "uname", "uptime",
    "pwd", "wc", "head", "tail", "grep", "find", "which", "df", "du",
    "free", "ps", "env", "printenv", "curl", "wget", "ping", "dig",
    "node", "npm", "npx", "python", "python3", "pip", "git",
  ]),

  /** Allowed working directories for shell commands */
  shellAllowedDirs: csvList(process.env.SHELL_ALLOWED_DIRS, [
    resolve("."),
    "/tmp",
  ]),

  /** Shell command timeout in milliseconds */
  shellTimeout: Number(process.env.SHELL_TIMEOUT) || 30000,

  // ── File Operations ────────────────────────────────────────
  /** Allowed file paths (directories). Files outside these are blocked. */
  fileAllowedPaths: csvList(process.env.FILE_ALLOWED_PATHS, [
    resolve("./workspace"),
    resolve("."),
    "/tmp",
  ]),

  /** Max file size in bytes for read/write operations */
  fileMaxSizeBytes: Number(process.env.FILE_MAX_SIZE_BYTES) || 1_048_576, // 1MB

  // ── Webhooks ───────────────────────────────────────────────
  /** Port for the webhook HTTP server */
  webhookPort: Number(process.env.PORT) || Number(process.env.WEBHOOK_PORT) || 3456,

  /** Optional shared secret for webhook authentication */
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",

  /** Secret token to authorize local<->production DB synchronization */
  syncSecret: process.env.SYNC_SECRET ?? "",

  // ── External APIs ──────────────────────────────────────────
  /** Sarvam AI API Key */
  sarvamApiKey: process.env.SARVAM_API_KEY ?? "",

  /** Todoist API Token */
  todoistApiToken: process.env.TODOIST_API_TOKEN ?? "",

  /** Google Sheets ID */
  googleSheetId: process.env.GOOGLE_SHEET_ID ?? "",

  /** Google Service Account JSON path */
  googleCredentialsPath: process.env.GOOGLE_CREDENTIALS_PATH ?? resolve("mycontex-238b05fd7b15.json"),


  // ── MCP Bridge ─────────────────────────────────────────────
  /** Path to MCP servers config JSON file */
  mcpConfigPath: process.env.MCP_CONFIG_PATH ?? "./mcp-servers.json",

  // ── Skills ─────────────────────────────────────────────────
  /** Path to skills directory containing .md files */
  skillsDir: process.env.SKILLS_DIR ?? "./skills",

  // ── Memory ────────────────────────────────────────────────
  /** Path to SQLite memory database */
  memoryDbPath: process.env.MEMORY_DB_PATH ?? "./data/cortex.db",

  /** Path to markdown notes directory */
  notesDir: process.env.NOTES_DIR ?? "./data/notes",

  /** Max context tokens before auto-pruning (rough estimate) */
  maxContextTokens: Number(process.env.MAX_CONTEXT_TOKENS) || 6000,

  /** Days before unused memories start decaying */
  memoryDecayDays: Number(process.env.MEMORY_DECAY_DAYS) || 30,

  // ── Semantic Memory (Mem0 + Pinecone) ─────────────────────
  /** Pinecone API key (free tier) */
  pineconeApiKey: process.env.PINECONE_API_KEY ?? "",

  /** Pinecone index name */
  pineconeIndexName: process.env.PINECONE_INDEX_NAME ?? "gravityclaw-memory",

  /** Pinecone host URL */
  pineconeHost: process.env.PINECONE_HOST ?? "",

  /** Embedding model for semantic memory */
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",

  /** Embedding dimensions (must match the model) */
  embeddingDims: Number(process.env.EMBEDDING_DIMS) || 1536,
} as const;

// Sanity check
if (config.allowedUserIds.length === 0) {
  console.error("❌ ALLOWED_USER_IDS must contain at least one valid Telegram user ID.");
  process.exit(1);
}
