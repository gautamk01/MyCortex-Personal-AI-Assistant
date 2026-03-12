import express, { Router } from "express";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { bot } from "../bot.js";

export const syncRouter = Router();

// Middleware to authenticate sync requests
syncRouter.use((req, res, next) => {
  const secret = req.headers["x-sync-secret"];
  if (!config.syncSecret || secret !== config.syncSecret) {
    res.status(401).json({ error: "Unauthorized sync request" });
    return;
  }
  next();
});

// ── Pause / Resume Telegram Polling ────────────────────────────

syncRouter.post("/pause", async (req, res) => {
  try {
    console.log("⏸️  Sync: Pausing remote bot polling...");
    await bot.stop();
    res.json({ success: true, message: "Remote bot paused" });
  } catch (err) {
    console.error("❌ Sync pause error:", err);
    res.status(500).json({ error: String(err) });
  }
});

syncRouter.post("/resume", (req, res) => {
  try {
    console.log("▶️  Sync: Resuming remote bot polling...");
    res.json({ success: true, message: "Remote bot resuming" });

    // Run asynchronously because bot.start() blocks forever while polling
    bot.start({
      onStart: () => console.log("✅ Remote bot resumed polling"),
    }).catch(err => console.error("❌ Bot start error:", err));
    
  } catch (err) {
    console.error("❌ Sync resume error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── DB Download / Upload ───────────────────────────────────────

syncRouter.get("/db", (req, res) => {
  try {
    const dbPath = resolve(config.memoryDbPath);
    console.log(`⬇️  Sync: Downloading DB from ${dbPath}`);
    res.download(dbPath, "cortex.db");
  } catch (err) {
    console.error("❌ Sync DB download error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Note: express.raw({ type: "application/octet-stream", limit: "50mb" }) is needed to accept binary SQLite files
syncRouter.post(
  "/db",
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  (req, res) => {
    try {
      const dbPath = resolve(config.memoryDbPath);
      console.log(`⬆️  Sync: Uploading DB to ${dbPath}`);
      
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer)) {
        res.status(400).json({ error: "Expected binary buffer" });
        return;
      }
      
      writeFileSync(dbPath, buffer);
      console.log(`✅ Sync: Overwrote DB (${buffer.length} bytes)`);
      res.json({ success: true, bytes: buffer.length });
    } catch (err) {
      console.error("❌ Sync DB upload error:", err);
      res.status(500).json({ error: String(err) });
    }
  }
);
