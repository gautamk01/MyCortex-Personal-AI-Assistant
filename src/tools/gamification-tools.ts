import { registerTool } from "./index.js";
import { completeDailyPlanItemByTodoistTaskId } from "../daily-plan.js";
import { getTodayTasks, addTask, completeTask } from "../todoist.js";
import {
  deleteLifeLog,
  deleteLeetCodeLog,
  deleteWorkLog,
  endLifeSession,
  getLifeLogs,
  getOpenLifeSession,
  getLeetCodeLogs,
  getWorkLogs,
  logLifeEventToSheet,
  logLeetCodeToSheet,
  logWorkSessionToSheet,
  startLifeSession,
  summarizeLifeLogs,
  summarizeWorkLogs,
  updateLifeLog,
  updateLeetCodeLog,
  updateWorkLog,
  type LifeCategory,
  type LifeEntryType,
  type LifeSource,
  type WorkCategory,
} from "../sheets.js";
import { getUserStats, addExp } from "../memory/sqlite.js";

// ── Todoist Tools ──────────────────────────────────────────────

registerTool({
  name: "fetch_today_tasks",
  description: "Fetches all tasks scheduled for today from Todoist.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const tasks = await getTodayTasks();
    if (tasks.length === 0) return "No tasks scheduled for today in Todoist.";
    return JSON.stringify(tasks, null, 2);
  },
});

registerTool({
  name: "add_todoist_task",
  description: "Adds a new task to the user's Todoist Inbox.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "The task description" },
      dueString: { type: "string", description: "Due date string, e.g. 'today', 'tomorrow', 'next monday'" },
      priority: { type: "number", description: "Priority 1 (normal) to 4 (urgent)" },
    },
    required: ["content"],
  },
  execute: async (input) => {
    const task = await addTask(
      input.content as string,
      (input.dueString as string) || "today",
      (input.priority as number) || 1
    );
    return `✅ Task added: "${task.content}" (due: ${task.due || "today"})`;
  },
});

registerTool({
  name: "complete_todoist_task",
  description: "Marks a Todoist task as complete by its ID and awards 10 EXP.",
  parameters: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "The Todoist task ID to complete" },
    },
    required: ["taskId"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    await completeTask(input.taskId as string);
    await completeDailyPlanItemByTodoistTaskId(chatId, input.taskId as string);
    const result = addExp(chatId, 10, `Completed Todoist task ${input.taskId}`);
    let msg = `✅ Task completed! +10 EXP (Total: ${result.newTotal}).`;
    if (result.levelUp) msg += ` 🎉 LEVEL UP → Level ${result.newLevel}!`;
    return msg;
  },
});

// ── Google Sheets Tool ─────────────────────────────────────────

registerTool({
  name: "log_leetcode_to_sheet",
  description: "Logs a solved LeetCode problem to Google Sheets and awards EXP (Easy=10, Medium=20, Hard=30).",
  parameters: {
    type: "object",
    properties: {
      problemName: { type: "string", description: "Name of the LeetCode problem" },
      difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"], description: "Difficulty level" },
      topic: { type: "string", description: "Topic/category (e.g. arrays, DP, graphs)" },
      timeMinutes: { type: "number", description: "Time taken in minutes" },
      notes: { type: "string", description: "Optional notes about the solution" },
    },
    required: ["problemName", "difficulty", "topic", "timeMinutes"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    await logLeetCodeToSheet(
      input.problemName as string,
      input.difficulty as "Easy" | "Medium" | "Hard",
      input.topic as string,
      input.timeMinutes as number,
      (input.notes as string) || ""
    );

    const expMap: Record<string, number> = { Easy: 10, Medium: 20, Hard: 30 };
    const exp = expMap[input.difficulty as string] || 10;

    const result = addExp(chatId, exp, `Solved LeetCode: ${input.problemName}`);
    let msg = `📊 Logged "${input.problemName}" to Sheets! +${exp} EXP (Total: ${result.newTotal}).`;
    if (result.levelUp) msg += ` 🎉 LEVEL UP → Level ${result.newLevel}!`;
    return msg;
  },
});

registerTool({
  name: "log_work_session_to_sheet",
  description:
    "Log a general work session to Google Sheets. Productive categories award EXP, entertainment categories deduct EXP, and neutral categories log without changing EXP.",
  parameters: {
    type: "object",
    properties: {
      workTitle: { type: "string", description: "What you worked on during the session." },
      category: {
        type: "string",
        enum: [
          "studying",
          "development",
          "project",
          "reading",
          "research",
          "fun",
          "movies",
          "gaming",
          "scrolling",
          "admin",
          "health",
          "other",
        ],
        description: "Fixed category used for reporting and EXP.",
      },
      tag: { type: "string", description: "Subject, project, or subtopic tag like DBMS or Gravity Claw." },
      timeMinutes: { type: "number", description: "Time spent in minutes." },
      output: { type: "string", description: "Optional concrete result from the session." },
      notes: { type: "string", description: "Optional additional notes." },
    },
    required: ["workTitle", "category", "tag", "timeMinutes"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const result = await logWorkSessionToSheet(
      input.workTitle as string,
      input.category as WorkCategory,
      input.tag as string,
      input.timeMinutes as number,
      (input.output as string) || "",
      (input.notes as string) || "",
    );

    if (result.exp !== 0) {
      addExp(chatId, result.exp, `Work log: ${input.workTitle}`);
    }

    const expText =
      result.exp > 0 ? ` +${result.exp} EXP.` : result.exp < 0 ? ` ${result.exp} EXP.` : " 0 EXP.";

    return `🧾 Logged "${input.workTitle}" under ${result.category} for ${input.timeMinutes} minutes.${expText}`;
  },
});

registerTool({
  name: "log_life_event",
  description:
    "Log a timestamped life event or completed session to the Life Log sheet. Use for wake-up, meals, study blocks, breaks, travel, sleep, and other day timeline events.",
  parameters: {
    type: "object",
    properties: {
      activity: { type: "string", description: "Human-readable event label like 'Woke up' or 'DBMS study'." },
      category: {
        type: "string",
        enum: [
          "sleep",
          "study",
          "development",
          "work",
          "meal",
          "exercise",
          "travel",
          "break",
          "entertainment",
          "personal",
          "admin",
          "other",
        ],
        description: "Simple life-log category used for summaries.",
      },
      tag: { type: "string", description: "Optional subtopic like DBMS, Gym, College, or Gravity Claw." },
      notes: { type: "string", description: "Optional notes." },
      source: {
        type: "string",
        enum: ["manual", "auto_split", "live"],
        description: "How this row was created. Default is manual.",
      },
      entryType: {
        type: "string",
        enum: ["point", "session", "open_session"],
        description: "Use point for single timestamp events, session for completed ranges, open_session for live tracking.",
      },
      startDate: { type: "string", description: "Optional start date in YYYY-MM-DD. Defaults to today in IST." },
      startTime: { type: "string", description: "Optional start time in hh:mm AM/PM or HH:MM 24-hour IST. Defaults to current IST time." },
      endDate: { type: "string", description: "Optional end date in YYYY-MM-DD for completed sessions." },
      endTime: { type: "string", description: "Optional end time in hh:mm AM/PM or HH:MM 24-hour IST for completed sessions." },
      durationMinutes: { type: "number", description: "Optional duration in minutes instead of end time." },
    },
    required: ["activity", "category"],
  },
  execute: async (input) => {
    const result = await logLifeEventToSheet({
      activity: input.activity as string,
      category: input.category as LifeCategory,
      tag: input.tag as string | undefined,
      notes: input.notes as string | undefined,
      source: input.source as LifeSource | undefined,
      entryType: input.entryType as LifeEntryType | undefined,
      startDate: input.startDate as string | undefined,
      startTime: input.startTime as string | undefined,
      endDate: input.endDate as string | undefined,
      endTime: input.endTime as string | undefined,
      durationMinutes: input.durationMinutes as number | undefined,
    });

    const durationText = result.row.durationMinutes === null ? "" : ` (${result.row.durationMinutes} mins)`;
    return `🕒 Logged life event "${result.row.activity}" under ${result.row.category}${durationText}.`;
  },
});

registerTool({
  name: "start_life_session",
  description:
    "Start a live life-log session now or at a given start time. If another live session is open, it is auto-closed at the new start time.",
  parameters: {
    type: "object",
    properties: {
      activity: { type: "string", description: "What is starting, like 'Studying DBMS' or 'Lunch'." },
      category: {
        type: "string",
        enum: [
          "sleep",
          "study",
          "development",
          "work",
          "meal",
          "exercise",
          "travel",
          "break",
          "entertainment",
          "personal",
          "admin",
          "other",
        ],
      },
      tag: { type: "string" },
      notes: { type: "string" },
      startDate: { type: "string", description: "Optional start date in YYYY-MM-DD." },
      startTime: { type: "string", description: "Optional start time in hh:mm AM/PM or HH:MM 24-hour IST." },
    },
    required: ["activity", "category"],
  },
  execute: async (input) => {
    const result = await startLifeSession({
      activity: input.activity as string,
      category: input.category as LifeCategory,
      tag: input.tag as string | undefined,
      notes: input.notes as string | undefined,
      startDate: input.startDate as string | undefined,
      startTime: input.startTime as string | undefined,
    });

    const autoClosed = result.autoClosedRowNumber
      ? ` Auto-closed previous open session on row ${result.autoClosedRowNumber}.`
      : "";
    return `▶️ Started "${result.row.activity}" at ${result.row.startTime}.${autoClosed}`;
  },
});

registerTool({
  name: "end_life_session",
  description: "End the current open life-log session now or at a specified time.",
  parameters: {
    type: "object",
    properties: {
      endDate: { type: "string", description: "Optional end date in YYYY-MM-DD." },
      endTime: { type: "string", description: "Optional end time in hh:mm AM/PM or HH:MM 24-hour IST." },
      notes: { type: "string", description: "Optional notes to append when ending the session." },
    },
    required: [],
  },
  execute: async (input) => {
    const result = await endLifeSession({
      endDate: input.endDate as string | undefined,
      endTime: input.endTime as string | undefined,
      notes: input.notes as string | undefined,
    });

    return `⏹️ Ended "${result.activity}" at ${result.endTime} (${result.durationMinutes} mins).`;
  },
});

// ── Gamification Tools ─────────────────────────────────────────

registerTool({
  name: "check_level",
  description: "Check the user's current gamification Level and total EXP.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const stats = getUserStats(chatId);
    const nextLevelExp = stats.level * 100;
    return `🏆 Level ${stats.level} | ${stats.totalExp} EXP | Next level at ${nextLevelExp} EXP.`;
  },
});

registerTool({
  name: "log_habit",
  description: "Award or deduct EXP for a good or bad habit. Use positive expAmount for good habits, negative for bad.",
  parameters: {
    type: "object",
    properties: {
      expAmount: { type: "number", description: "EXP to award (positive) or deduct (negative)" },
      habitDescription: { type: "string", description: "What the habit was" },
    },
    required: ["expAmount", "habitDescription"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const amount = input.expAmount as number;
    const result = addExp(chatId, amount, input.habitDescription as string);

    if (amount >= 0) {
      let msg = `💪 +${amount} EXP for "${input.habitDescription}" (Total: ${result.newTotal}).`;
      if (result.levelUp) msg += ` 🎉 LEVEL UP → Level ${result.newLevel}!`;
      return msg;
    } else {
      return `⚠️ ${amount} EXP for "${input.habitDescription}". Total: ${result.newTotal}. Level: ${result.newLevel}.`;
    }
  },
});

// ── Google Sheets CRUD Tools ───────────────────────────────────

registerTool({
  name: "get_leetcode_logs",
  description: "Fetches recent LeetCode logs from Google Sheets (returns rowNumber and problem details).",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Number of recent logs to fetch (default 10)" },
    },
    required: [],
  },
  execute: async (input) => {
    const limit = (input.limit as number) || 10;
    const logs = await getLeetCodeLogs(limit);
    if (logs.length === 0) return "No LeetCode logs found in the sheet.";
    return JSON.stringify(logs, null, 2);
  },
});

registerTool({
  name: "get_work_logs",
  description: "Fetches recent daily work logs from Google Sheets.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Number of recent work logs to fetch (default 10)." },
    },
    required: [],
  },
  execute: async (input) => {
    const limit = (input.limit as number) || 10;
    const logs = await getWorkLogs(limit);
    if (logs.length === 0) return "No daily work logs found in the sheet.";
    return JSON.stringify(logs, null, 2);
  },
});

registerTool({
  name: "get_life_logs",
  description: "Fetch recent life-log rows from the Life Log sheet. Defaults to today unless a date range is supplied.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Number of recent life logs to fetch (default 10)." },
      dateFrom: { type: "string", description: "Optional start date in YYYY-MM-DD." },
      dateTo: { type: "string", description: "Optional end date in YYYY-MM-DD." },
    },
    required: [],
  },
  execute: async (input) => {
    const limit = (input.limit as number) || 10;
    const logs = await getLifeLogs(
      limit,
      input.dateFrom as string | undefined,
      input.dateTo as string | undefined,
    );
    if (logs.length === 0) return "No life log rows found for that range.";
    return JSON.stringify(logs, null, 2);
  },
});

registerTool({
  name: "get_open_life_session",
  description: "Return the currently open live life-log session, if any.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const session = await getOpenLifeSession();
    if (!session) return "No open life session found.";
    return JSON.stringify(session, null, 2);
  },
});

registerTool({
  name: "update_leetcode_log",
  description: "Updates an existing LeetCode log row in Google Sheets.",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to update (get this from get_leetcode_logs)" },
      problemName: { type: "string" },
      difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
      topic: { type: "string" },
      timeMinutes: { type: "number" },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await updateLeetCodeLog(rowNumber, {
      problemName: input.problemName as string,
      difficulty: input.difficulty as "Easy" | "Medium" | "Hard",
      topic: input.topic as string,
      timeMinutes: input.timeMinutes as number,
    });
    return `✅ Successfully updated row ${rowNumber} in Google Sheets.`;
  },
});

registerTool({
  name: "update_work_log",
  description: "Updates an existing daily work log row in Google Sheets without recalculating EXP.",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to update (get this from get_work_logs)." },
      workTitle: { type: "string" },
      category: {
        type: "string",
        enum: [
          "studying",
          "development",
          "project",
          "reading",
          "research",
          "fun",
          "movies",
          "gaming",
          "scrolling",
          "admin",
          "health",
          "other",
        ],
      },
      tag: { type: "string" },
      timeMinutes: { type: "number" },
      output: { type: "string" },
      notes: { type: "string" },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await updateWorkLog(rowNumber, {
      workTitle: input.workTitle as string | undefined,
      category: input.category as WorkCategory | undefined,
      tag: input.tag as string | undefined,
      timeMinutes: input.timeMinutes as number | undefined,
      output: input.output as string | undefined,
      notes: input.notes as string | undefined,
    });
    return `✅ Successfully updated daily work log row ${rowNumber}.`;
  },
});

registerTool({
  name: "update_life_log",
  description: "Updates an existing life-log row in Google Sheets and recalculates duration when time fields change.",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to update (get this from get_life_logs)." },
      startDate: { type: "string" },
      startTime: { type: "string" },
      endDate: { type: "string" },
      endTime: { type: "string" },
      durationMinutes: { type: "number" },
      activity: { type: "string" },
      category: {
        type: "string",
        enum: [
          "sleep",
          "study",
          "development",
          "work",
          "meal",
          "exercise",
          "travel",
          "break",
          "entertainment",
          "personal",
          "admin",
          "other",
        ],
      },
      tag: { type: "string" },
      entryType: { type: "string", enum: ["point", "session", "open_session"] },
      source: { type: "string", enum: ["manual", "auto_split", "live"] },
      notes: { type: "string" },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await updateLifeLog(rowNumber, {
      startDate: input.startDate as string | undefined,
      startTime: input.startTime as string | undefined,
      endDate: input.endDate as string | undefined,
      endTime: input.endTime as string | undefined,
      durationMinutes: input.durationMinutes as number | undefined,
      activity: input.activity as string | undefined,
      category: input.category as LifeCategory | undefined,
      tag: input.tag as string | undefined,
      entryType: input.entryType as LifeEntryType | undefined,
      source: input.source as LifeSource | undefined,
      notes: input.notes as string | undefined,
    });
    return `✅ Successfully updated life log row ${rowNumber}.`;
  },
});

registerTool({
  name: "delete_leetcode_log",
  description: "Deletes a LeetCode log row in Google Sheets",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to delete (get this from get_leetcode_logs)" },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await deleteLeetCodeLog(rowNumber);
    return `🗑️ Successfully deleted row ${rowNumber} from Google Sheets.`;
  },
});

registerTool({
  name: "delete_work_log",
  description: "Deletes a daily work log row in Google Sheets.",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to delete (get this from get_work_logs)." },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await deleteWorkLog(rowNumber);
    return `🗑️ Successfully deleted daily work log row ${rowNumber}.`;
  },
});

registerTool({
  name: "delete_life_log",
  description: "Deletes a life-log row from Google Sheets.",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to delete (get this from get_life_logs)." },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await deleteLifeLog(rowNumber);
    return `🗑️ Successfully deleted life log row ${rowNumber}.`;
  },
});

registerTool({
  name: "summarize_work_logs",
  description: "Summarize daily work logs by category and tag for a date range. Defaults to today.",
  parameters: {
    type: "object",
    properties: {
      dateFrom: { type: "string", description: "Optional start date in YYYY-MM-DD format." },
      dateTo: { type: "string", description: "Optional end date in YYYY-MM-DD format." },
    },
    required: [],
  },
  execute: async (input) => {
    const summary = await summarizeWorkLogs(
      input.dateFrom as string | undefined,
      input.dateTo as string | undefined,
    );

    if (summary.logs.length === 0) {
      return `No work logs found between ${summary.dateFrom} and ${summary.dateTo}.`;
    }

    return JSON.stringify({
      dateFrom: summary.dateFrom,
      dateTo: summary.dateTo,
      totalMinutes: summary.totalMinutes,
      totalExp: summary.totalExp,
      totalsByCategory: summary.totalsByCategory,
      totalsByTag: summary.totalsByTag,
    }, null, 2);
  },
});

registerTool({
  name: "summarize_life_logs",
  description: "Summarize life-log timeline and totals for a date range. Defaults to today.",
  parameters: {
    type: "object",
    properties: {
      dateFrom: { type: "string", description: "Optional start date in YYYY-MM-DD format." },
      dateTo: { type: "string", description: "Optional end date in YYYY-MM-DD format." },
    },
    required: [],
  },
  execute: async (input) => {
    const summary = await summarizeLifeLogs(
      input.dateFrom as string | undefined,
      input.dateTo as string | undefined,
    );

    if (summary.timeline.length === 0) {
      return `No life log rows found between ${summary.dateFrom} and ${summary.dateTo}.`;
    }

    return JSON.stringify(summary, null, 2);
  },
});
