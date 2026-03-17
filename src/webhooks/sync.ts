import express, { Router } from "express";
import { writeFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import * as tar from "tar";
import { config } from "../config.js";
import { bot } from "../bot.js";
import { getDb, initDatabase } from "../memory/sqlite.js";
import { startHeartbeat, stopHeartbeat } from "../heartbeat.js";
import { pauseAllTasks, resumeAllTasks } from "../scheduler/index.js";

export const syncRouter = Router();
// ... (middleware unchanged)
// ── Pause / Resume Telegram Polling & Schedules ──────────────────

syncRouter.post("/pause", async (req, res) => {
  try {
    console.log("⏸️  Sync: Pausing remote bot polling and schedules...");
    await bot.stop();
    stopHeartbeat();
    pauseAllTasks();
    res.json({ success: true, message: "Remote bot and schedules paused" });
  } catch (err) {
    console.error("❌ Sync pause error:", err);
    res.status(500).json({ error: String(err) });
  }
});

syncRouter.post("/resume", (req, res) => {
  try {
    console.log("▶️  Sync: Resuming remote bot polling and schedules...");
    startHeartbeat();
    resumeAllTasks();
    res.json({ success: true, message: "Remote bot and schedules resuming" });

    // Run asynchronously because bot.start() blocks forever while polling
    bot.start({
      onStart: () => console.log("✅ Remote bot resumed polling"),
    }).catch(err => console.error("❌ Bot start error:", err));
    
  } catch (err) {
    console.error("❌ Sync resume error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── DB & Notes Download / Upload ───────────────────────────────

syncRouter.get("/data", (req, res) => {
  try {
    const baseDataDir = resolve(config.baseDataDir);
    console.log(`⬇️  Sync: Downloading data from ${baseDataDir}`);

    // Checkpoint WAL to ensure the .db file is fully up-to-date
    try {
      getDb().pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // DB might not be initialized yet, proceed anyway
    }

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", 'attachment; filename="data.tar.gz"');

    tar.create(
      {
        gzip: true,
        cwd: baseDataDir,
        filter: (path) => {
          // Explicitly ignore SQLite WAL and SHM files to prevent corruption
          return !path.endsWith("-wal") && !path.endsWith("-shm");
        },
      },
      ["."] // Pack everything in the base data dir
    ).pipe(res);

  } catch (err) {
    console.error("❌ Sync data download error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Note: express.raw({ type: "application/octet-stream", limit: "50mb" }) is needed to accept binary tarballs
syncRouter.post(
  "/data",
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  async (req, res) => {
    try {
      const baseDataDir = resolve(config.baseDataDir);
      console.log(`⬆️  Sync: Uploading data to ${baseDataDir}`);
      
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer)) {
        res.status(400).json({ error: "Expected binary buffer" });
        return;
      }
      
      // Close the existing DB connection before overwriting files
      try {
        getDb().close();
      } catch {
        // DB might not be open, that's fine
      }

      // !! CRITICAL: Delete stale WAL and SHM files locally before extraction.
      if (existsSync(baseDataDir)) {
        const files = readdirSync(baseDataDir);
        for (const file of files) {
          if (file.endsWith("-wal") || file.endsWith("-shm")) {
            unlinkSync(join(baseDataDir, file));
            console.log(`   🗑️  Deleted stale ${file} file`);
          }
        }
      }

      // Save the tarball temporarily
      const tmpPath = resolve("/tmp/sync-upload.tar.gz");
      writeFileSync(tmpPath, buffer);

      // Extract the tarball, overwriting existing files
      await tar.extract({
        file: tmpPath,
        cwd: baseDataDir,
      });

      unlinkSync(tmpPath);
      console.log(`✅ Sync: Extracted data (${buffer.length} bytes)`);

      // Reopen the DB connection so the app uses the new data
      initDatabase();
      console.log("🔄 Sync: Reopened database with uploaded data");

      res.json({ success: true, bytes: buffer.length });
    } catch (err) {
      console.error("❌ Sync data upload error:", err);
      res.status(500).json({ error: String(err) });
    }
  }
);
