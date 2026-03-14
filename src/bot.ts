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
    "🧠 *Cortex is online.*\n\n" +
      "I'm your personal AI assistant with persistent memory and a daily planning loop.\n\n" +
      "📝 /text — replies in text only _(default)_\n" +
      "🔊 /voice — replies in voice only\n" +
      "🖥️ /gui — use visible desktop actions\n" +
      "💻 /terminal — use background shell _(default)_\n" +
      "🗜️ /compact — compress conversation history\n" +
      "📅 /plan — create or rebuild today's plan\n" +
      "📋 /today — show today's plan\n" +
      "🌙 /review — run the evening review now\n\n" +
      "💡 Try: _Plan my day around DBMS revision and one LeetCode problem_\n" +
      "💡 Try: _Remind me to buy milk at 4 PM_",
    { parse_mode: "Markdown" }
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
  await ctx.reply("📝 Switched to *text mode* — I'll reply with text only.", {
    parse_mode: "Markdown",
  });
});

// ── /voice command ─────────────────────────────────────────────

bot.command("voice", async (ctx) => {
  chatModes.set(ctx.chat.id, "voice");
  await ctx.reply("🔊 Switched to *voice mode* — I'll reply with voice only.", {
    parse_mode: "Markdown",
  });
});

// ── /gui and /terminal commands ────────────────────────────────

bot.command("gui", async (ctx) => {
  interfaceModes.set(ctx.chat.id, "gui");
  const { setBrowserMode } = await import("./tools/browser.js");
  await setBrowserMode("gui");
  await ctx.reply("🖥️ Switched to *GUI mode* — I'll use visible browser and terminal windows.", {
    parse_mode: "Markdown",
  });
});

bot.command("terminal", async (ctx) => {
  interfaceModes.set(ctx.chat.id, "terminal");
  const { setBrowserMode } = await import("./tools/browser.js");
  await setBrowserMode("terminal");
  await ctx.reply("💻 Switched to *Terminal mode* — I'll use headless browser and background shell.", {
    parse_mode: "Markdown",
  });
});

// ── /compact command ──────────────────────────────────────────

bot.command("compact", async (ctx) => {
  const chatId = ctx.chat.id;
  const history = getHistory(chatId);
  const result = compactHistory(history);
  await ctx.reply(`🗜️ ${result}`, { parse_mode: "Markdown" });
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
    const response = await runAgentLoop(chatId, instruction, interfaceMode, progress.reporter);
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

// ── /codex command ─────────────────────────────────────────────

bot.command("codex", async (ctx) => {
  const chatId = ctx.chat.id;
  const prompt = ctx.match?.trim(); // text after /codex

  if (!prompt) {
    await ctx.reply(
      "🤖 *Codex CLI*\n\n" +
        "Send a prompt after the command:\n" +
        "`/codex explain this code`\n" +
        "`/codex write a quicksort in TypeScript`\n\n" +
        "Or just say _\"ask codex to...\"_ in any message.",
      { parse_mode: "Markdown" }
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
      await ctx.reply(`🤖 *Codex:*\n\n${trimmed}`, { parse_mode: "Markdown" });
    } else {
      // Split into chunks
      const chunks: string[] = [];
      let remaining = trimmed;
      while (remaining.length > 0) {
        const cut = remaining.length <= 4000 ? remaining.length : remaining.lastIndexOf("\n", 4000);
        chunks.push(remaining.slice(0, cut === -1 ? 4000 : cut));
        remaining = remaining.slice(cut === -1 ? 4000 : cut).trimStart();
      }
      for (let i = 0; i < chunks.length; i++) {
        await ctx.reply(i === 0 ? `🤖 *Codex:*\n\n${chunks[i]}` : chunks[i], { parse_mode: "Markdown" });
      }
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
    const response = await runAgentLoop(chatId, userMessage, interfaceMode, progress.reporter);

    if (mode === "text") {
      // ── Text mode: send text only ──
      if (response.length <= 4096) {
        await ctx.reply(response);
      } else {
        const chunks = splitMessage(response, 4096);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }
    } else {
      // ── Voice mode: send voice only ──
      try {
        const cleanText = stripMarkdown(response);
        const audio = await textToSpeech(cleanText);
        if (audio) {
          await ctx.replyWithVoice(new InputFile(audio, "voice.wav"));
        } else {
          // TTS unavailable — fall back to text
          await ctx.reply(response);
          await ctx.reply("⚠️ _TTS server is not running. Falling back to text._", {
            parse_mode: "Markdown",
          });
        }
      } catch (ttsError) {
        console.warn("⚠️  TTS failed:", ttsError);
        await ctx.reply(response);
        await ctx.reply("⚠️ _Voice generation failed. Sent text instead._", {
          parse_mode: "Markdown",
        });
      }
    }
  } catch (error) {
    console.error("❌ Agent error:", error);
    await ctx.reply("Something went wrong while processing your message. Please try again.");
  } finally {
    await progress.cleanup();
  }
});

// ── Handle voice messages ──────────────────────────────────────

bot.on("message:voice", async (ctx) => {
  const chatId = ctx.chat.id;
  const mode = getMode(chatId);
  const interfaceMode = getInterfaceMode(chatId);

  const progress = await createProgressController(
    ctx,
    mode === "voice" ? "record_voice" : "typing",
  );

  try {
    // 1. Download the voice file
    const file = await ctx.getFile();
    const downloadUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    
    // Fetch file contents into a buffer
    const fetch = await import("undici").then(m => m.fetch);
    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) throw new Error("Could not download voice message from Telegram.");
    
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // 2. Transcribe via Sarvam AI
    const { speechToText } = await import("./stt.js");
    const transcript = await speechToText(audioBuffer, "audio/ogg");

    if (!transcript) {
      await ctx.reply("⚠️ Sorry, I couldn't understand that voice message. The speech-to-text service might be unavailable.");
      return;
    }

    // 3. User feedback: Mirror what they said
    await ctx.reply(`🎙️ *What you said:* "${transcript}"`, { parse_mode: "Markdown" });

    // 4. Run the transcript through the AI Agent loop
    const response = await runAgentLoop(chatId, transcript, interfaceMode, progress.reporter);

    // 5. Reply (respecting text/voice mode preference)
    if (mode === "text") {
      if (response.length <= 4096) {
        await ctx.reply(response);
      } else {
        const chunks = splitMessage(response, 4096);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }
    } else {
      try {
        const cleanText = stripMarkdown(response);
        const audio = await textToSpeech(cleanText);
        if (audio) {
          await ctx.replyWithVoice(new InputFile(audio, "voice.wav"));
        } else {
          await ctx.reply(response);
          await ctx.reply("⚠️ _TTS server is not running. Falling back to text._", {
            parse_mode: "Markdown",
          });
        }
      } catch (ttsError) {
        console.warn("⚠️  TTS failed:", ttsError);
        await ctx.reply(response);
        await ctx.reply("⚠️ _Voice generation failed. Sent text instead._", {
          parse_mode: "Markdown",
        });
      }
    }
  } catch (error) {
    console.error("❌ STT/Agent error:", error);
    await ctx.reply("Something went wrong while processing your voice message. Please try again.");
  } finally {
    await progress.cleanup();
  }
});

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Strip markdown formatting so TTS reads clean text.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")       // remove code blocks
    .replace(/`([^`]+)`/g, "$1")          // inline code → plain text
    .replace(/!\[.*?\]\(.*?\)/g, "")      // remove images
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1") // links → just the text
    .replace(/^#{1,6}\s+/gm, "")          // remove heading markers
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")  // ***bold italic*** → plain
    .replace(/\*\*(.+?)\*\*/g, "$1")      // **bold** → plain
    .replace(/\*(.+?)\*/g, "$1")          // *italic* → plain
    .replace(/__(.+?)__/g, "$1")          // __underline__ → plain
    .replace(/_(.+?)_/g, "$1")            // _italic_ → plain
    .replace(/~~(.+?)~~/g, "$1")          // ~~strikethrough~~ → plain
    .replace(/^[\s]*[-*+]\s/gm, "")       // bullet points → plain
    .replace(/^\d+\.\s/gm, "")            // numbered lists → plain
    .replace(/^>\s?/gm, "")               // blockquotes → plain
    .replace(/---+/g, "")                 // horizontal rules → nothing
    .replace(/\n{3,}/g, "\n\n")           // collapse excess newlines
    .trim();
}

/**
 * Split a long message into chunks that respect Telegram's limit.
 * Tries to split on newlines for clean breaks.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at the last newline within the limit
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Fall back to splitting at max length
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

async function replyText(
  ctx: Context,
  text: string,
): Promise<void> {
  if (text.length <= 4096) {
    await ctx.reply(text);
    return;
  }

  const chunks = splitMessage(text, 4096);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
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
