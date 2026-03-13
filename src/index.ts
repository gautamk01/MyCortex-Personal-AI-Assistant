import { config } from "./config.js";
import { bot } from "./bot.js";
import { loadTools } from "./tools/index.js";
import { setSchedulerCallback, stopAllTasks } from "./scheduler/index.js";
import { setWebhookCallback, startWebhookServer, stopWebhookServer } from "./webhooks/index.js";
import { initMCPBridge, closeMCPBridge } from "./mcp/index.js";
import { loadSkills } from "./skills/index.js";
import { runAgentLoop } from "./agent.js";
import { getInterfaceMode } from "./bot.js";
import { closeAllTerminals } from "./tools/terminal.js";
import { initMemory } from "./memory/index.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";

// ── Load tools before starting ─────────────────────────────────

await loadTools();

// ── Initialize subsystems ──────────────────────────────────────

// Skills system — loads .md files from skills directory
await loadSkills();

// Memory system — SQLite, knowledge graph, markdown notes
await initMemory();

// MCP bridge — connects to configured MCP servers
await initMCPBridge();

// Scheduler — wire up the callback to inject messages into agent loop
setSchedulerCallback(async (chatId, message) => {
  try {
    const response = await runAgentLoop(chatId, message, getInterfaceMode(chatId));
    await bot.api.sendMessage(chatId, response);
  } catch (err) {
    console.error(`❌ Scheduler callback failed for chat ${chatId}:`, err);
  }
});

// Webhooks — wire up the callback to inject messages into agent loop
setWebhookCallback(async (chatId, message) => {
  try {
    const response = await runAgentLoop(chatId, message, getInterfaceMode(chatId));
    await bot.api.sendMessage(chatId, response);
  } catch (err) {
    console.error(`❌ Webhook callback failed for chat ${chatId}:`, err);
  }
});

// Start webhook HTTP server
startWebhookServer();

// Heartbeat — daily LeetCode accountability check-in
startHeartbeat();

// ── Startup ────────────────────────────────────────────────────

console.log("───────────────────────────────────────────");
console.log("🧠 Cortex v0.2.0");
console.log(`   Model:    ${config.llmModel}`);
console.log(`   Users:    ${config.allowedUserIds.length} whitelisted`);
console.log(`   Max iter: ${config.maxAgentIterations}`);
console.log(`   Webhook:  http://localhost:${config.webhookPort}`);
console.log(`   Skills:   ${config.skillsDir}`);
console.log("───────────────────────────────────────────");

// ── Graceful shutdown ──────────────────────────────────────────

async function shutdown() {
  console.log("\n👋 Shutting down…");
  bot.stop();
  stopAllTasks();
  stopHeartbeat();
  stopWebhookServer();
  await closeMCPBridge();
  // Lazy-imported browser — close if it was used
  try {
    const { closeBrowser } = await import("./tools/browser.js");
    await closeBrowser();
  } catch { /* not loaded */ }
  closeAllTerminals();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// ── Start bot (long-polling, NO webhook) ───────────────────────

bot.start({
  onStart: () => {
    console.log("✅ Gravity Claw is online — waiting for messages…");
  },
});
