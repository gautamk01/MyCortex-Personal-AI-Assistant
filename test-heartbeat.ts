import { buildHourlySnapshot, chooseHeartbeatToneFromProfile } from "./src/coach.js";
import { buildContextCandidates, chooseContextCandidate, generateHourlyMessage, buildHourlyPrompt } from "./src/heartbeat.js";
import { config } from "./src/config.js";
import { initDatabase } from "./src/memory/sqlite.js";

async function test() {
  initDatabase();
  const chatId = config.allowedUserIds[0];
  const snapshot = await buildHourlySnapshot(chatId);
  const tone = chooseHeartbeatToneFromProfile(snapshot.profile, false);
  const candidates = buildContextCandidates(snapshot);
  const selectedCandidate = chooseContextCandidate(snapshot);
  const theme = selectedCandidate?.theme ?? "focus";

  console.log("ALL CANDIDATES:");
  for (const c of candidates) {
    console.log(`- PRIORITY: ${c.priority} | LAST SEEN: ${c.lastSeenAt} | ASK COUNT: ${c.askCount} | SUBJECT: ${c.subject}`);
  }

  console.log("\nCHOSEN CANDIDATE:");
  console.log(selectedCandidate);

  console.log("\nGENERATING LLM MESSAGE...");
  const msg = await generateHourlyMessage(chatId, snapshot, theme, tone, 0, selectedCandidate);
  console.log("==> " + msg);
}

test().catch(console.error);
