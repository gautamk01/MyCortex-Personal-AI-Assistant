import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import * as dotenv from "dotenv";

dotenv.config();

const SYNC_SECRET = process.env.SYNC_SECRET;
const PROD_URL = process.env.PROD_WEBHOOK_URL; // e.g. https://mycortex-claw-production.up.railway.app
const DB_PATH = resolve(process.env.MEMORY_DB_PATH ?? "./data/cortex.db");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds between retries

if (!SYNC_SECRET || !PROD_URL) {
  console.error("❌ SYNC_SECRET or PROD_WEBHOOK_URL missing in .env");
  console.error("   Cannot synchronize with production database.");
  process.exit(1);
}

const syncHeaders = {
  "x-sync-secret": SYNC_SECRET!,
};

// ── Helper: check if an error is a network issue ───────────────
function isNetworkError(err: any): boolean {
  const msg = err?.message ?? "";
  const causeCode = err?.cause?.code ?? "";
  return (
    msg.includes("fetch failed") ||
    msg.includes("EAI_AGAIN") ||
    causeCode === "ENOTFOUND" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "ETIMEDOUT"
  );
}

// ── Helper: sleep ──────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Helper: retry wrapper ──────────────────────────────────────
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (isNetworkError(err) && attempt < retries) {
        console.log(
          `   ⏳ Attempt ${attempt}/${retries} failed (network). Retrying in ${RETRY_DELAY_MS / 1000}s...`,
        );
        await sleep(RETRY_DELAY_MS);
      } else {
        throw err; // either not a network error or last attempt
      }
    }
  }
  throw new Error(`${label}: all ${retries} attempts failed`);
}

// ── Sync functions ─────────────────────────────────────────────

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

  // Verify the downloaded file is a valid SQLite database
  try {
    const testDb = new Database(DB_PATH, { readonly: true });
    const tables = testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as Array<{ name: string }>;
    testDb.close();
    console.log(`   📋 Tables found: ${tables.map(t => t.name).join(", ")}`);
  } catch (err) {
    console.error("⚠️  Downloaded file may not be a valid SQLite database:", err);
  }
}

async function uploadDatabase() {
  console.log("⬆️  Uploading local database to production...");
  if (!existsSync(DB_PATH)) {
    console.log("⚠️  Local database not found, skipping upload.");
    return;
  }

  // !! CRITICAL: Checkpoint the WAL before reading the file.
  // SQLite WAL mode keeps all writes in cortex.db-wal (not the main .db file).
  // Without this, we'd upload a near-empty 4KB file and lose all memories.
  try {
    const tmpDb = new Database(DB_PATH);
    tmpDb.pragma("wal_checkpoint(TRUNCATE)");
    tmpDb.close();
    console.log("   ✅ WAL checkpoint complete — all data flushed to main DB file.");
  } catch (err) {
    console.warn("   ⚠️  WAL checkpoint failed (proceeding anyway):", err);
  }

  const buffer = readFileSync(DB_PATH);
  console.log(`   📦 DB size after checkpoint: ${(buffer.length / 1024).toFixed(1)} KB`);
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

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("🔄 Starting Cortex Local Sync Wrapper...");
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
      // Try to upload DB and resume production (with retries in case network just came back)
      await withRetry("Upload DB", uploadDatabase, 2).catch((e) => {
        if (isNetworkError(e)) {
          console.error("⚠️  Could not upload database (network unreachable). Local DB is saved at:", DB_PATH);
        } else {
          throw e;
        }
      });

      await withRetry("Resume bot", resumeRemoteBot, 2).catch((e) => {
        if (isNetworkError(e)) {
          console.error("⚠️  Could not resume production bot (network unreachable).");
          console.error("   💡 Run: curl -X POST -H 'x-sync-secret: <secret>' " + PROD_URL + "/api/sync/resume");
          console.error("   Or just restart Railway from the dashboard to bring production back.\n");
        } else {
          throw e;
        }
      });

      console.log("🌅 Shutdown complete.");
      process.exit(0);
    } catch (err) {
      console.error("❌ Fatal error during shutdown sync:", err);
      process.exit(1);
    }
  };

  // Catch termination signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // ── Startup: pause production and download DB (with retries) ──
  try {
    await withRetry("Pause production", pauseRemoteBot);
    await withRetry("Download DB", downloadDatabase);
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.error("\n❌ Could not reach production server after 3 attempts.");
      console.error("   Your network cannot resolve: " + PROD_URL);
      console.error("\n   ⚠️  NOT starting local bot to avoid Telegram 409 conflict.");
      console.error("   (Production may still be running and polling Telegram.)\n");
      console.error("   💡 Fix options:");
      console.error("     1. Check your Wi-Fi / internet connection");
      console.error("     2. Try switching to mobile hotspot");
      console.error("     3. Restart Railway from the dashboard, then retry\n");
    } else {
      console.error("❌ Startup sync failed:", err);
    }
    process.exit(1);
  }

  // ── Start local bot ──────────────────────────────────────────
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
