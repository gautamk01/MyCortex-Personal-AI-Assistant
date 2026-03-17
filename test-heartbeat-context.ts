import assert from "node:assert/strict";
import { buildContextDrivenMessage, chooseContextCandidate, type HeartbeatContextCandidate } from "./src/heartbeat.js";

function makeSnapshot(overrides: Record<string, unknown> = {}): any {
  return {
    date: "2026-03-17",
    profile: {
      chatId: 1,
      toneMode: "normal",
      encouragementStyle: "warm_firm",
      pressureStyle: "firm",
      driftScore: 0,
      loggingReliability: 0.5,
      activeStartHour: 8,
      activeEndHour: 22,
    },
    plan: null,
    work: {
      totalMinutes: 0,
      totalsByCategory: {},
      totalsByTag: {},
      totalExp: 0,
      dateFrom: "2026-03-17",
      dateTo: "2026-03-17",
      logs: [],
    },
    life: {
      dateFrom: "2026-03-17",
      dateTo: "2026-03-17",
      timeline: [],
      totalsByCategory: {},
      totalMinutes: 0,
      focusedMinutes: 0,
      breakMinutes: 0,
      entertainmentMinutes: 0,
      wakeUpTime: null,
      openSession: null,
    },
    reminders: [],
    recentThemes: [],
    contexts: [],
    ...overrides,
  };
}

const withOpenSession = makeSnapshot({
  life: {
    dateFrom: "2026-03-17",
    dateTo: "2026-03-17",
    timeline: [],
    totalsByCategory: {},
    totalMinutes: 60,
    focusedMinutes: 60,
    breakMinutes: 0,
    entertainmentMinutes: 0,
    wakeUpTime: null,
    openSession: {
      activity: "resume edits",
      startTime: "10:00 AM",
    },
  },
  contexts: [
    {
      contextKey: "dbms revision",
      subject: "DBMS revision",
      sourceType: "conversation",
      status: "active",
      updatedAt: "2026-03-17 09:00:00",
      askCount: 0,
    },
  ],
});

const selectedFromOpenSession = chooseContextCandidate(withOpenSession);
assert.equal(selectedFromOpenSession?.subject, "resume edits");

const withConversationOnly = makeSnapshot({
  contexts: [
    {
      contextKey: "portfolio work",
      subject: "portfolio work",
      sourceType: "conversation",
      status: "active",
      updatedAt: "2026-03-17 11:00:00",
      askCount: 0,
    },
  ],
});

const selectedFromConversation = chooseContextCandidate(withConversationOnly);
assert.equal(selectedFromConversation?.subject, "portfolio work");

const initialMessage = buildContextDrivenMessage(
  {
    contextKey: "resume edits",
    subject: "resume edits",
    sourceType: "conversation",
    priority: 90,
    askCount: 0,
    theme: "focus",
    reason: "today_conversation_context",
    observation: "Earlier you were on resume edits.",
  } satisfies HeartbeatContextCandidate,
  "normal",
);
assert.match(initialMessage, /How is "resume edits" going\?/);

const blockerMessage = buildContextDrivenMessage(
  {
    contextKey: "resume edits",
    subject: "resume edits",
    sourceType: "conversation",
    priority: 90,
    askCount: 2,
    theme: "focus",
    reason: "today_conversation_context",
    observation: "Earlier you were on resume edits.",
  } satisfies HeartbeatContextCandidate,
  "strict",
);
assert.match(blockerMessage, /blocking "resume edits"/i);
assert.match(blockerMessage, /Answer plainly\./);

console.log("heartbeat context checks passed");
