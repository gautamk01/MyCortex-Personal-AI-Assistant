import { config } from "./config.js";
import { bot, sendReminderNotification, sendTelegramText } from "./bot.js";
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
import { setReminderDispatch, stopAllReminders } from "./reminders.js";
import { startVoiceServer, stopVoiceServer } from "./voice/voice-server.js";

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
    await sendTelegramText(chatId, response);
  } catch (err) {
    console.error(`❌ Scheduler callback failed for chat ${chatId}:`, err);
  }
});

// Webhooks — wire up the callback to inject messages into agent loop
setWebhookCallback(async (chatId, message) => {
  try {
    const response = await runAgentLoop(chatId, message, getInterfaceMode(chatId));
    await sendTelegramText(chatId, response);
  } catch (err) {
    console.error(`❌ Webhook callback failed for chat ${chatId}:`, err);
  }
});

setReminderDispatch(async (reminder) => {
  try {
    await sendReminderNotification(reminder);
  } catch (err) {
    console.error(`❌ Reminder dispatch failed for chat ${reminder.chatId}:`, err);
  }
});

// Start webhook HTTP server
startWebhookServer();

// Heartbeat — daily LeetCode accountability check-in
startHeartbeat();

// Voice WebSocket server — JARVIS-like real-time voice agent
if (process.env.NODE_ENV !== "production") {
  startVoiceServer();
} else {
  console.log("ℹ️  Voice agent disabled in production mode");
}

// ── Startup ────────────────────────────────────────────────────

console.log("───────────────────────────────────────────");
console.log("🧠 Cortex v0.2.0");
console.log(`   Model:    ${config.llmModel}`);
console.log(`   Users:    ${config.allowedUserIds.length} whitelisted`);
console.log(`   Max iter: ${config.maxAgentIterations}`);
console.log(`   Webhook:  http://localhost:${config.webhookPort}`);
console.log(`   Voice WS: ws://localhost:${config.voiceWsPort}`);
console.log(`   Skills:   ${config.skillsDir}`);
console.log("───────────────────────────────────────────");

// ── Graceful shutdown ──────────────────────────────────────────

async function shutdown() {
  console.log("\n👋 Shutting down…");
  bot.stop();
  stopAllTasks();
  stopAllReminders();
  stopHeartbeat();
  stopVoiceServer();
  stopWebhookServer();
  await closeMCPBridge();
  // Close BrowserOS connections — SDK agent first (sends session-end HTTP),
  // then MCP transport (lower-level connection)
  try {
    const { closeSDKAgent } = await import("./tools/browse-sdk.js");
    await closeSDKAgent();
  } catch { /* not loaded */ }
  try {
    const { closeBrowserOS } = await import("./tools/browseros.js");
    await closeBrowserOS();
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
