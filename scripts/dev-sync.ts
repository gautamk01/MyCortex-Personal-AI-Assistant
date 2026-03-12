import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config();

const SYNC_SECRET = process.env.SYNC_SECRET;
const PROD_URL = process.env.PROD_WEBHOOK_URL; // e.g. https://mycortex-claw-production.up.railway.app
const DB_PATH = resolve(process.env.MEMORY_DB_PATH ?? "./data/cortex.db");

if (!SYNC_SECRET || !PROD_URL) {
  console.error("❌ SYNC_SECRET or PROD_WEBHOOK_URL missing in .env");
  console.error("   Cannot synchronize with production database.");
  process.exit(1);
}

const syncHeaders = {
  "x-sync-secret": SYNC_SECRET!,
};

async function pauseRemoteBot() {
  console.log("⏸️  Requesting production bot to pause...");
  const res = await fetch(`${PROD_URL}/api/sync/pause`, {
    method: "POST",
    headers: syncHeaders,
  });
  if (!res.ok) throw new Error(`Pause failed: ${await res.text()}`);
  console.log("✅ Production bot paused.");
}

async function resumeRemoteBot() {
  console.log("▶️  Requesting production bot to resume...");
  const res = await fetch(`${PROD_URL}/api/sync/resume`, {
    method: "POST",
    headers: syncHeaders,
  });
  if (!res.ok) throw new Error(`Resume failed: ${await res.text()}`);
  console.log("✅ Production bot resumed.");
}

async function downloadDatabase() {
  console.log("⬇️  Downloading production database...");
  const res = await fetch(`${PROD_URL}/api/sync/db`, {
    headers: syncHeaders,
  });
  if (!res.ok) throw new Error(`Download failed: ${await res.text()}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  
  // Ensure data dir exists
  const dir = resolve(DB_PATH, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  
  writeFileSync(DB_PATH, buffer);
  console.log(`✅ Downloaded database (${buffer.length} bytes) to ${DB_PATH}`);
}

async function uploadDatabase() {
  console.log("⬆️  Uploading local database to production...");
  if (!existsSync(DB_PATH)) {
    console.log("⚠️  Local database not found, skipping upload.");
    return;
  }

  const buffer = readFileSync(DB_PATH);
  const res = await fetch(`${PROD_URL}/api/sync/db`, {
    method: "POST",
    headers: {
      ...syncHeaders,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });
  
  if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`);
  const json = await res.json();
  console.log(`✅ Uploaded database successfully (${json.bytes} bytes).`);
}

async function main() {
  console.log("🔄 Starting Gravity Claw Local Sync Wrapper...");
  let botProcess: import("node:child_process").ChildProcess | null = null;
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\n🛑 Shutdown sequence initiated...");

    if (botProcess) {
      console.log("🛑 Terminating local bot...");
      botProcess.kill("SIGINT");
      // Wait a moment for graceful sqlite closing
      await new Promise((r) => setTimeout(r, 1000));
    }

    try {
      await uploadDatabase();
      await resumeRemoteBot();
      console.log("🌅 Sync complete. Production is live.");
      process.exit(0);
    } catch (err) {
      console.error("❌ Fatal error during shutdown sync:", err);
      process.exit(1);
    }
  };

  // Catch termination signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await pauseRemoteBot();
    await downloadDatabase();
  } catch (err) {
    console.error("❌ Startup sync failed:", err);
    console.log("⚠️  Will attempt to resume remote bot before exiting...");
    await resumeRemoteBot().catch((e) => console.error("   Failed to resume:", e));
    process.exit(1);
  }

  console.log("🚀 Starting local bot process...");
  botProcess = spawn("npx", ["tsx", "watch", "src/index.ts"], {
    stdio: "inherit",
    shell: true,
  });

  botProcess.on("close", (code) => {
    console.log(`Local process exited with code ${code}`);
    shutdown();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
