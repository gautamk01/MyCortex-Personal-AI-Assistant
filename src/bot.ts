import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { formatDailyPlan, getDailyPlan } from "./daily-plan.js";
import { config } from "./config.js";
import {
  runAgentLoop,
  getHistory,
  type AgentProgressPhase,
  type AgentProgressReporter,
} from "./agent.js";
import { textToSpeech } from "./tts.js";
import { compactHistory } from "./memory/context-pruner.js";
import {
  getReminderDueLabel,
  markReminderDone,
  snoozeReminder,
  type ReminderRecord,
} from "./reminders.js";
import {
  TELEGRAM_HTML_PARSE_MODE,
  prepareTelegramHtmlChunks,
  stripTelegramHtml,
} from "./telegram-html.js";

// ── Create bot ─────────────────────────────────────────────────

export const bot = new Bot(config.telegramBotToken);

const REMINDER_CALLBACK_PREFIX = "reminder";

// ── Per-chat reply mode ────────────────────────────────────────

type ReplyMode = "text" | "voice";
const chatModes = new Map<number, ReplyMode>();

function getMode(chatId: number): ReplyMode {
  return chatModes.get(chatId) ?? "text";
}

// ── Per-chat interface mode ──────────────────────────────────────

export type InterfaceMode = "gui" | "terminal";
const interfaceModes = new Map<number, InterfaceMode>();

export function getInterfaceMode(chatId: number): InterfaceMode {
  return interfaceModes.get(chatId) ?? "terminal";
}

// ── Security middleware: user ID whitelist ──────────────────────
// This runs FIRST on every update. Non-whitelisted users are
// silently ignored — no response, no error, no information leak.

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !config.allowedUserIds.includes(userId)) {
    // Silently drop — don't reveal the bot exists to strangers
    return;
  }
  await next();
});

// ── /start command ─────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🧠 <b>Cortex is online.</b>\n\n" +
      "I'm your personal AI assistant with persistent memory and a daily planning loop.\n\n" +
      "📝 /text — replies in text only <i>(default)</i>\n" +
      "🔊 /voice — replies in voice only\n" +
      "🖥️ /gui — use visible desktop actions\n" +
      "💻 /terminal — use background shell <i>(default)</i>\n" +
      "🗜️ /compact — compress conversation history\n" +
      "📅 /plan — create or rebuild today's plan\n" +
      "📋 /today — show today's plan\n" +
      "🌙 /review — run the evening review now\n" +
      "⏱️ /hourly — send one hourly check-in now\n" +
      "🧠 /daysummary — show today's stored daily summary\n\n" +
      "💡 Try: <i>Plan my day around DBMS revision and one LeetCode problem</i>\n" +
      "💡 Try: <i>Remind me to buy milk at 4 PM</i>",
    { parse_mode: TELEGRAM_HTML_PARSE_MODE }
  );
});

bot.on("callback_query:data", async (ctx) => {
  const payload = ctx.callbackQuery.data;
  if (!payload.startsWith(`${REMINDER_CALLBACK_PREFIX}:`)) {
    return;
  }

  const parts = payload.split(":");
  const action = parts[1];

  try {
    if (action === "done") {
      const reminderId = parts[2];
      const reminder = markReminderDone(reminderId);
      if (!reminder) {
        await ctx.answerCallbackQuery({ text: "Reminder no longer active." });
        return;
      }

      if (ctx.callbackQuery.message) {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          ctx.callbackQuery.message.message_id,
          `✅ Reminder done: ${reminder.text}`,
        );
      }

      await ctx.answerCallbackQuery({ text: "Marked done." });
      return;
    }

    if (action === "snooze") {
      const minutes = Number(parts[2]);
      const reminderId = parts[3];
      const reminder = snoozeReminder(reminderId, minutes);
      if (!reminder) {
        await ctx.answerCallbackQuery({ text: "Reminder no longer active." });
        return;
      }

      const nextDue = getReminderDueLabel(reminder);
      if (ctx.callbackQuery.message) {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          ctx.callbackQuery.message.message_id,
          `😴 Snoozed "${reminder.text}" until ${nextDue}.`,
        );
      }

      await ctx.answerCallbackQuery({ text: `Snoozed for ${minutes}m.` });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Unknown reminder action." });
  } catch (error) {
    console.error("❌ Reminder callback failed:", error);
    await ctx.answerCallbackQuery({ text: "Reminder action failed." });
  }
});

// ── /text command ──────────────────────────────────────────────

bot.command("text", async (ctx) => {
  chatModes.set(ctx.chat.id, "text");
  await ctx.reply("📝 Switched to <b>text mode</b> - I'll reply with text only.", {
    parse_mode: TELEGRAM_HTML_PARSE_MODE,
  });
});

// ── /voice command ─────────────────────────────────────────────

bot.command("voice", async (ctx) => {
  chatModes.set(ctx.chat.id, "voice");
  await ctx.reply("🔊 Switched to <b>voice mode</b> - I'll reply with voice only.", {
    parse_mode: TELEGRAM_HTML_PARSE_MODE,
  });
});

// ── /gui and /terminal commands ────────────────────────────────

bot.command("gui", async (ctx) => {
  interfaceModes.set(ctx.chat.id, "gui");
  const { setBrowserMode } = await import("./tools/browser.js");
  await setBrowserMode("gui");
  await ctx.reply("🖥️ Switched to <b>GUI mode</b> - I'll use visible browser and terminal windows.", {
    parse_mode: TELEGRAM_HTML_PARSE_MODE,
  });
});

bot.command("terminal", async (ctx) => {
  interfaceModes.set(ctx.chat.id, "terminal");
  const { setBrowserMode } = await import("./tools/browser.js");
  await setBrowserMode("terminal");
  await ctx.reply("💻 Switched to <b>Terminal mode</b> - I'll use headless browser and background shell.", {
    parse_mode: TELEGRAM_HTML_PARSE_MODE,
  });
});

// ── /compact command ──────────────────────────────────────────

bot.command("compact", async (ctx) => {
  const chatId = ctx.chat.id;
  const history = getHistory(chatId);
  const result = compactHistory(history);
  await replyText(ctx, `🗜️ ${result}`);
});

bot.command("plan", async (ctx) => {
  const chatId = ctx.chat.id;
  const interfaceMode = getInterfaceMode(chatId);
  const prompt = ctx.match?.trim();
  const progress = await createProgressController(ctx, "typing");

  try {
    const instruction = prompt
      ? `Create or rebuild my plan for today using these constraints: ${prompt}. Use the daily plan tools, keep it to at most 3 must-do items, and sync it to Todoist when the plan is final.`
      : "Help me create my plan for today. If critical details are missing, ask a concise follow-up. Once you have enough information, create the plan with daily plan tools and sync it to Todoist.";
    const response = await runAgentLoop(chatId, instruction, interfaceMode, progress.reporter, ctx.message?.message_id);
    await replyText(ctx, response);
  } catch (error) {
    console.error("❌ Plan command error:", error);
    await ctx.reply("Could not build today's plan right now. Please try again.");
  } finally {
    await progress.cleanup();
  }
});

bot.command("today", async (ctx) => {
  const chatId = ctx.chat.id;
  const plan = getDailyPlan(chatId);
  await replyText(ctx, formatDailyPlan(plan));
});

bot.command("review", async (ctx) => {
  const progress = await createProgressController(ctx, "typing");
  const { sendEveningReview } = await import("./heartbeat.js");
  try {
    await sendEveningReview(ctx.chat.id);
  } finally {
    await progress.cleanup();
  }
});

bot.command("morning", async (ctx) => {
  const progress = await createProgressController(ctx, "typing");
  const { sendMorningCheckIn } = await import("./heartbeat.js");
  try {
    await sendMorningCheckIn(ctx.chat.id);
  } finally {
    await progress.cleanup();
  }
});

bot.command("hourly", async (ctx) => {
  const progress = await createProgressController(ctx, "typing");
  const { sendHourlyCheckIn } = await import("./heartbeat.js");
  try {
    await sendHourlyCheckIn(ctx.chat.id);
  } finally {
    await progress.cleanup();
  }
});

bot.command("daysummary", async (ctx) => {
  const { getDailySummary, listDailySummaries } = await import("./coach.js");
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = today.find((part) => part.type === "year")?.value ?? "0000";
  const month = today.find((part) => part.type === "month")?.value ?? "00";
  const day = today.find((part) => part.type === "day")?.value ?? "00";
  const summaryDate = `${year}-${month}-${day}`;
  const summary = getDailySummary(ctx.chat.id, summaryDate);

  if (!summary) {
    const latest = listDailySummaries(ctx.chat.id, 1)[0];
    if (!latest) {
      await ctx.reply(`No daily summary stored yet for ${summaryDate}.`);
      return;
    }

    await replyText(ctx, `${latest.summaryDate}\n\n${latest.summaryText}`);
    return;
  }

  await replyText(ctx, `${summary.summaryDate}\n\n${summary.summaryText}`);
});

// ── /codex command ─────────────────────────────────────────────

bot.command("codex", async (ctx) => {
  const chatId = ctx.chat.id;
  const prompt = ctx.match?.trim(); // text after /codex

  if (!prompt) {
    await ctx.reply(
      "🤖 <b>Codex CLI</b>\n\n" +
        "Send a prompt after the command:\n" +
        "/codex explain this code\n" +
        "/codex write a quicksort in TypeScript\n\n" +
        "Or just say <i>\"ask codex to...\"</i> in any message.",
      { parse_mode: TELEGRAM_HTML_PARSE_MODE }
    );
    return;
  }

  const progress = await createProgressController(ctx, "typing");

  try {
    const { execFile } = await import("node:child_process");
    const { readFile, unlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const CODEX_BIN = "/home/gautam/.nvm/versions/node/v22.17.0/bin/codex";
    const outputFile = join(tmpdir(), `gclaw-codex-direct-${Date.now()}.txt`);
    await progress.reporter.update("using_tools");

    const response = await new Promise<string>((resolve, reject) => {
      execFile(
        CODEX_BIN,
        ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
          "--output-last-message", outputFile, "--", prompt],
        { cwd: process.env.HOME, timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, TERM: "dumb" } },
        async (error, _stdout, stderr) => {
          let text = "";
          try { text = await readFile(outputFile, "utf-8"); } catch { text = ""; }
          await unlink(outputFile).catch(() => {});
          if (!text && error) reject(error);
          else resolve(text || stderr || "Codex completed without a text response.");
        }
      );
    });

    const trimmed = response.trim();
    if (trimmed.length <= 4096) {
      await replyText(ctx, `🤖 <b>Codex:</b>\n\n${trimmed}`);
    } else {
      await replyText(ctx, `🤖 <b>Codex:</b>\n\n${trimmed}`);
    }
  } catch (error) {
    await ctx.reply(`❌ Codex error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await progress.cleanup();
  }
});

// ── Handle all text messages ───────────────────────────────────

bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;
  const mode = getMode(chatId);
  const interfaceMode = getInterfaceMode(chatId);

  const progress = await createProgressController(
    ctx,
    mode === "voice" ? "record_voice" : "typing",
  );

  try {
    const response = await runAgentLoop(chatId, userMessage, interfaceMode, progress.reporter, ctx.message.message_id);

    if (mode === "text") {
      // ── Text mode: send text only ──
      await replyText(ctx, response);
    } else {
      // ── Voice mode: send voice only ──
      try {
        const cleanText = stripTelegramHtml(response);
        const audio = await textToSpeech(cleanText);
        if (audio) {
          await ctx.replyWithVoice(new InputFile(audio, "voice.wav"));
        } else {
          // TTS unavailable — fall back to text
          await replyText(ctx, response);
          await replyText(ctx, "⚠️ <i>TTS server is not running. Falling back to text.</i>");
        }
      } catch (ttsError) {
        console.warn("⚠️  TTS failed:", ttsError);
        await replyText(ctx, response);
        await replyText(ctx, "⚠️ <i>Voice generation failed. Sent text instead.</i>");
      }
    }
  } catch (error) {
    console.error("❌ Agent error:", error);
    await ctx.reply("Something went wrong while processing your message. Please try again.");
  } finally {
    await progress.cleanup();
  }
});

// ── Handle speech input messages ───────────────────────────────

const MAX_STT_BYTES = 20 * 1024 * 1024;

type SpeechInputDetails = {
  sourceType: "voice" | "audio" | "document";
  mimeType: string;
  filename: string;
  fileSize: number;
};

function getSpeechInputDetails(ctx: Context): SpeechInputDetails | null {
  const message = ctx.message;
  if (!message) return null;

  if ("voice" in message && message.voice) {
    return {
      sourceType: "voice",
      mimeType: message.voice.mime_type || "audio/ogg",
      filename: "voice_message.ogg",
      fileSize: message.voice.file_size || 0,
    };
  }

  if ("audio" in message && message.audio) {
    return {
      sourceType: "audio",
      mimeType: message.audio.mime_type || "audio/mpeg",
      filename: message.audio.file_name || "audio_message",
      fileSize: message.audio.file_size || 0,
    };
  }

  if ("document" in message && message.document) {
    const mimeType = message.document.mime_type || "";
    const filename = message.document.file_name || "audio_document";
    const looksLikeAudio = mimeType.startsWith("audio/") || /\.(ogg|mp3|wav|m4a|aac|webm|mpeg)$/i.test(filename);
    if (!looksLikeAudio) {
      return null;
    }

    return {
      sourceType: "document",
      mimeType: mimeType || "application/octet-stream",
      filename,
      fileSize: message.document.file_size || 0,
    };
  }

  return null;
}

async function handleSpeechMessage(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  const mode = getMode(chatId);
  const interfaceMode = getInterfaceMode(chatId);
  const input = getSpeechInputDetails(ctx);

  if (!input) {
    await ctx.reply("⚠️ I can only transcribe voice notes or audio files.");
    return;
  }

  const progress = await createProgressController(
    ctx,
    mode === "voice" ? "record_voice" : "typing",
  );

  try {
    if (input.fileSize > MAX_STT_BYTES) {
      await ctx.reply("⚠️ That audio file is too large for the current transcription path. Send a shorter or compressed recording.");
      return;
    }

    // 1. Download the Telegram audio file
    const file = await ctx.getFile();
    if (!file.file_path) {
      throw new Error("Telegram did not return a downloadable file path.");
    }
    const downloadUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

    // Fetch file contents into a buffer
    const fetch = await import("undici").then(m => m.fetch);
    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) throw new Error(`Could not download ${input.sourceType} message from Telegram.`);

    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    if (audioBuffer.length === 0) {
      throw new Error("Downloaded audio file is empty.");
    }

    // 2. Transcribe via Sarvam AI
    const { speechToText } = await import("./stt.js");
    const transcript = await speechToText(audioBuffer, input.mimeType, input.filename);

    if (!transcript) {
      await ctx.reply("⚠️ I couldn't transcribe that audio. The format may be unsupported, the file may be too large, or Sarvam may have rejected it.");
      return;
    }

    // 3. User feedback: Mirror what they said
    await replyText(ctx, `🎙️ <b>What you said:</b> "${transcript}"`);

    // 4. Run the transcript through the AI Agent loop
    const response = await runAgentLoop(chatId, transcript, interfaceMode, progress.reporter, ctx.message?.message_id);

    // 5. Reply (respecting text/voice mode preference)
    if (mode === "text") {
      await replyText(ctx, response);
    } else {
      try {
        const cleanText = stripTelegramHtml(response);
        const audio = await textToSpeech(cleanText);
        if (audio) {
          await ctx.replyWithVoice(new InputFile(audio, "voice.wav"));
        } else {
          await replyText(ctx, response);
          await replyText(ctx, "⚠️ <i>TTS server is not running. Falling back to text.</i>");
        }
      } catch (ttsError) {
        console.warn("⚠️  TTS failed:", ttsError);
        await replyText(ctx, response);
        await replyText(ctx, "⚠️ <i>Voice generation failed. Sent text instead.</i>");
      }
    }
  } catch (error) {
    console.error(`❌ STT/Agent error [${input.sourceType}] [${input.mimeType}] [${input.filename}] [${input.fileSize} bytes]:`, error);
    await ctx.reply("Something went wrong while transcribing that audio. Please try again with a shorter or supported recording.");
  } finally {
    await progress.cleanup();
  }
}

bot.on("message:voice", handleSpeechMessage);
bot.on("message:audio", handleSpeechMessage);
bot.on("message:document", async (ctx) => {
  if (!getSpeechInputDetails(ctx)) {
    return;
  }
  await handleSpeechMessage(ctx);
});

// ── Helpers ─────────────────────────────────────────────────────

export async function sendTelegramText(
  chatId: number,
  text: string,
): Promise<void> {
  const chunks = prepareTelegramHtmlChunks(text);
  for (const chunk of chunks) {
    await bot.api.sendMessage(chatId, chunk, { parse_mode: TELEGRAM_HTML_PARSE_MODE });
  }
}

async function replyText(
  ctx: Context,
  text: string,
): Promise<void> {
  const chunks = prepareTelegramHtmlChunks(text);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: TELEGRAM_HTML_PARSE_MODE });
  }
}

function buildReminderKeyboard(reminderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Done", `${REMINDER_CALLBACK_PREFIX}:done:${reminderId}`)
    .row()
    .text("10m", `${REMINDER_CALLBACK_PREFIX}:snooze:10:${reminderId}`)
    .text("30m", `${REMINDER_CALLBACK_PREFIX}:snooze:30:${reminderId}`)
    .text("1h", `${REMINDER_CALLBACK_PREFIX}:snooze:60:${reminderId}`);
}

export async function sendReminderNotification(reminder: ReminderRecord): Promise<void> {
  const lines = [
    "⏰ Reminder",
    "",
    reminder.text,
    "",
    `Due: ${getReminderDueLabel(reminder)}`,
    reminder.notes ? `Note: ${reminder.notes}` : "",
    "",
    "Done or snooze it?",
  ].filter(Boolean);

  await bot.api.sendMessage(reminder.chatId, lines.join("\n"), {
    reply_markup: buildReminderKeyboard(reminder.id),
  });
}

type ProgressAction = "typing" | "record_voice";

function getProgressLabel(phase: AgentProgressPhase): string {
  switch (phase) {
    case "checking_memory":
      return "Checking memory...";
    case "using_tools":
      return "Using tools...";
    case "writing_response":
      return "Writing response...";
    case "thinking":
    default:
      return "Thinking...";
  }
}

async function createProgressController(
  ctx: Context,
  action: ProgressAction,
): Promise<{
  reporter: AgentProgressReporter;
  cleanup: () => Promise<void>;
}> {
  const chatId = ctx.chat?.id ?? null;
  let currentLabel = "Thinking...";
  let cleanedUp = false;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let statusMessageId: number | null = null;

  const sendAction = async () => {
    try {
      await ctx.replyWithChatAction(action);
    } catch {
      // Non-critical
    }
  };

  const scheduleSlowUpdate = () => {
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = setTimeout(() => {
      void setLabel("Still working...");
    }, 8000);
  };

  const setLabel = async (nextLabel: string) => {
    if (cleanedUp || nextLabel === currentLabel) return;
    currentLabel = nextLabel;

    if (statusMessageId === null || chatId === null) return;

    try {
      await ctx.api.editMessageText(chatId, statusMessageId, nextLabel);
    } catch {
      // Non-critical
    }
  };

  await sendAction();

  try {
    const message = await ctx.reply(currentLabel);
    statusMessageId = message.message_id;
  } catch {
    statusMessageId = null;
  }

  const actionInterval = setInterval(() => {
    if (cleanedUp) return;
    void sendAction();
  }, 4000);

  scheduleSlowUpdate();

  return {
    reporter: {
      update: async (phase: AgentProgressPhase) => {
        await setLabel(getProgressLabel(phase));
        scheduleSlowUpdate();
      },
    },
    cleanup: async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(actionInterval);
      if (slowTimer) clearTimeout(slowTimer);

      if (statusMessageId !== null && chatId !== null) {
        try {
          await ctx.api.deleteMessage(chatId, statusMessageId);
        } catch {
          // Non-critical
        }
      }
    },
  };
}
