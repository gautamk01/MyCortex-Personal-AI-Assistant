import { initMemory } from "./src/memory/index.js";
import { getLifeLogs, deleteLifeLog } from "./src/sheets.js";
import { listNotes, deleteNote } from "./src/memory/markdown.js";
import { forgetFact } from "./src/memory/sqlite.js";
import { config } from "./src/config.js";
import { unlinkSync, existsSync } from "node:fs";

async function undo() {
  console.log("🔄 Starting undo of test actions...");
  
  const chatId = config.allowedUserIds[0];
  if (!chatId) {
    console.error("❌ No allowed user IDs found in config.");
    return;
  }

  try {
    await initMemory();

    // 1. Delete Google Sheet row
    console.log("\n--- Cleaning Google Sheets ---");
    const logs = await getLifeLogs(50); // check last 50
    const testLogRow = logs.find(l => l.activity === "System Test Activity");
    if (testLogRow) {
      await deleteLifeLog(testLogRow.rowNumber);
      console.log(`✅ Deleted Life Log row: ${testLogRow.rowNumber}`);
    } else {
      console.log("ℹ️ No 'System Test Activity' found in Life Log.");
    }

    // 2. Delete Markdown Notes
    console.log("\n--- Cleaning Markdown Notes ---");
    const notesOutput = await listNotes(chatId);
    // listNotes returns a string. We need to parse it or just use readdirSync.
    // Actually, I'll just use the slug logic if I can find the titles.
    // The test note title was "Test Note <timestamp>".
    // Let's look for files starting with "test-note-" in the directory.
    const { join } = await import("node:path");
    const { readdirSync } = await import("node:fs");
    const notesDir = join(config.notesDir, String(chatId));
    if (existsSync(notesDir)) {
      const files = readdirSync(notesDir);
      for (const file of files) {
        if (file.startsWith("test-note-") && file.endsWith(".md")) {
          unlinkSync(join(notesDir, file));
          console.log(`✅ Deleted note file: ${file}`);
        }
      }
    }

    // 3. Forget SQLite Facts
    console.log("\n--- Cleaning SQLite Facts ---");
    const f1 = await forgetFact(chatId, "name");
    const f2 = await forgetFact(chatId, "ai_building_interest");
    console.log(`✅ ${f1}`);
    console.log(`✅ ${f2}`);

    // 4. Delete Test Files
    console.log("\n--- Deleting Test Scripts ---");
    const testFiles = ["test-system.ts", "test-agent-smoke.ts", "test-system.js", "test-agent-smoke.js"];
    for (const file of testFiles) {
      if (existsSync(file)) {
        unlinkSync(file);
        console.log(`✅ Deleted: ${file}`);
      }
    }

    console.log("\n✅ Undo completed successfully!");
  } catch (error) {
    console.error("\n❌ Undo failed:", error);
  }
}

undo();
