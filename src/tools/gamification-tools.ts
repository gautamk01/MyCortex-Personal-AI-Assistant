import { registerTool } from "./index.js";
import { completeDailyPlanItemByTodoistTaskId } from "../daily-plan.js";
import { getTodayTasks, addTask, completeTask } from "../todoist.js";
import {
  deleteLeetCodeLog,
  getLeetCodeLogs,
  logLeetCodeToSheet,
  updateLeetCodeLog,
  getISTDateTime,
  logCompanyToSheet,
  getCompanyLogs,
  updateCompanyLog,
  deleteCompanyLog,
  type CompanyStatus,
} from "../sheets.js";
import { getUserStats, addExp } from "../memory/sqlite.js";
import {
  logWorkSession,
  getWorkLogs,
  updateWorkLog,
  deleteWorkLog,
  summarizeWorkLogs,
  logLifeEvent,
  getLifeLogs,
  updateLifeLog,
  deleteLifeLog,
  summarizeLifeLogs,
} from "../memory/local-logs.js";

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

// ── LeetCode Tools ─────────────────────────────────────────────

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
      notes: { type: "string", description: "Optional notes about the approach, key insight, or mistakes" },
      revisionDate: { type: "string", description: "If revision is needed, the date to revisit in YYYY-MM-DD format. Leave empty if no revision needed." },
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
      (input.notes as string) || "",
      (input.revisionDate as string) || "",
    );

    const expMap: Record<string, number> = { Easy: 10, Medium: 20, Hard: 30 };
    const exp = expMap[input.difficulty as string] || 10;

    const result = addExp(chatId, exp, `Solved LeetCode: ${input.problemName}`);
    let msg = `📊 Logged "${input.problemName}" to Sheets! +${exp} EXP (Total: ${result.newTotal}).`;
    if (input.revisionDate) msg += ` 📅 Revision scheduled: ${input.revisionDate}.`;
    if (result.levelUp) msg += ` 🎉 LEVEL UP → Level ${result.newLevel}!`;
    return msg;
  },
});

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
      notes: { type: "string", description: "Notes about the approach, key insight, or mistakes" },
      revisionDate: { type: "string", description: "Revision date in YYYY-MM-DD format. Set to empty string to clear." },
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
      notes: input.notes as string,
      revisionDate: input.revisionDate as string,
    });
    return `✅ Successfully updated row ${rowNumber} in Google Sheets.`;
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

// ── Company / Job Tracker Tools ────────────────────────────────

registerTool({
  name: "log_company",
  description: "Log a company/job application to the Company Tracker tab in Google Sheets. Use this when the user mentions applying to a company, finding a job listing, or wants to track a company.",
  parameters: {
    type: "object",
    properties: {
      company: { type: "string", description: "Company name" },
      role: { type: "string", description: "Job title / role" },
      status: {
        type: "string",
        enum: ["Interested", "Applied", "OA", "Interview", "Offer", "Rejected", "Withdrawn", "Accepted"],
        description: "Current application status",
      },
      platform: { type: "string", description: "Where the job was found (e.g. LinkedIn, Naukri, company website, referral)" },
      link: { type: "string", description: "URL of the job posting (optional)" },
      notes: { type: "string", description: "Optional notes" },
    },
    required: ["company", "role", "status", "platform"],
  },
  execute: async (input) => {
    await logCompanyToSheet(
      input.company as string,
      input.role as string,
      input.status as CompanyStatus,
      input.platform as string,
      (input.link as string) || "",
      (input.notes as string) || "",
    );
    return `📋 Logged "${input.company} — ${input.role}" (${input.status}) to Company Tracker!`;
  },
});

registerTool({
  name: "get_company_logs",
  description: "Fetches recent company/job application logs from Google Sheets (returns rowNumber and details).",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Number of recent entries to fetch (default 10)" },
    },
    required: [],
  },
  execute: async (input) => {
    const limit = (input.limit as number) || 10;
    const logs = await getCompanyLogs(limit);
    if (logs.length === 0) return "No company logs found in the sheet.";
    return JSON.stringify(logs, null, 2);
  },
});

registerTool({
  name: "update_company_log",
  description: "Updates an existing company/job application row in Google Sheets.",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to update (get from get_company_logs)" },
      company: { type: "string" },
      role: { type: "string" },
      status: {
        type: "string",
        enum: ["Interested", "Applied", "OA", "Interview", "Offer", "Rejected", "Withdrawn", "Accepted"],
      },
      platform: { type: "string" },
      link: { type: "string" },
      notes: { type: "string" },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await updateCompanyLog(rowNumber, {
      company: input.company as string,
      role: input.role as string,
      status: input.status as CompanyStatus,
      platform: input.platform as string,
      link: input.link as string,
      notes: input.notes as string,
    });
    return `✅ Updated company log row ${rowNumber} in Google Sheets.`;
  },
});

registerTool({
  name: "delete_company_log",
  description: "Deletes a company/job application row from Google Sheets.",
  parameters: {
    type: "object",
    properties: {
      rowNumber: { type: "number", description: "The row number to delete (get from get_company_logs)" },
    },
    required: ["rowNumber"],
  },
  execute: async (input) => {
    const rowNumber = input.rowNumber as number;
    await deleteCompanyLog(rowNumber);
    return `🗑️ Deleted company log row ${rowNumber} from Google Sheets.`;
  },
});

// ── Local SQLite Tools (Work & Life Logs) ──────────────────────

registerTool({
  name: "log_work_session",
  description:
    "Log a general work session locally. Productive categories award EXP, entertainment categories deduct EXP.",
  parameters: {
    type: "object",
    properties: {
      logDate: { type: "string", description: "Date in YYYY-MM-DD. Defaults to today." },
      category: { type: "string", description: "Category of work (e.g. studying, development, reading, gaming, fun, admin)" },
      durationMinutes: { type: "number", description: "Time spent in minutes." },
      description: { type: "string", description: "What you worked on." },
    },
    required: ["category", "durationMinutes", "description"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const { date } = getISTDateTime();
    const logDate = (input.logDate as string) || date;
    
    const result = await logWorkSession(
      chatId,
      logDate,
      input.category as string,
      input.durationMinutes as number,
      input.description as string
    );

    const expText = result.expAdded > 0 ? ` +${result.expAdded} EXP.` : result.expAdded < 0 ? ` ${result.expAdded} EXP.` : " 0 EXP.";
    return `🧾 Logged "${input.description}" (${input.durationMinutes}m) under ${input.category}.${expText}`;
  },
});

registerTool({
  name: "get_work_logs",
  description: "Fetches recent daily work logs from the local database.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Number of recent work logs to fetch (default 10)." },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const limit = (input.limit as number) || 10;
    const logs = await getWorkLogs(chatId, limit);
    if (logs.length === 0) return "No work logs found.";
    return JSON.stringify(logs, null, 2);
  },
});

registerTool({
  name: "update_work_log",
  description: "Updates an existing work log row in the local database.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "The ID of the work log to update." },
      logDate: { type: "string" },
      category: { type: "string" },
      durationMinutes: { type: "number" },
      description: { type: "string" },
    },
    required: ["id"],
  },
  execute: async (input) => {
    await updateWorkLog(input.id as number, {
      logDate: input.logDate as string | undefined,
      category: input.category as string | undefined,
      durationMinutes: input.durationMinutes as number | undefined,
      description: input.description as string | undefined,
    });
    return `✅ Successfully updated work log ID ${input.id}.`;
  },
});

registerTool({
  name: "delete_work_log",
  description: "Deletes a work log row from the local database.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "The ID of the work log to delete." },
    },
    required: ["id"],
  },
  execute: async (input) => {
    await deleteWorkLog(input.id as number);
    return `🗑️ Successfully deleted work log ID ${input.id}.`;
  },
});

registerTool({
  name: "log_life_event",
  description: "Log a life event or session locally (e.g. sleep, meals, travel, study).",
  parameters: {
    type: "object",
    properties: {
      logDate: { type: "string", description: "Date in YYYY-MM-DD. Defaults to today." },
      startTime: { type: "string", description: "Start time in hh:mm AM/PM. Defaults to now." },
      endTime: { type: "string", description: "End time in hh:mm AM/PM. Defaults to now." },
      durationMinutes: { type: "number", description: "Duration in minutes." },
      category: { type: "string", description: "Category (e.g. sleep, meal, work, study, travel)." },
      description: { type: "string", description: "Description of the activity." },
    },
    required: ["durationMinutes", "category", "description"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const { date, time } = getISTDateTime();
    
    await logLifeEvent({
      chatId,
      logDate: (input.logDate as string) || date,
      startTime: (input.startTime as string) || time,
      endTime: (input.endTime as string) || time,
      durationMinutes: input.durationMinutes as number,
      category: input.category as string,
      description: input.description as string,
    });

    return `🕒 Logged life event "${input.description}" under ${input.category} (${input.durationMinutes} mins).`;
  },
});

registerTool({
  name: "get_life_logs",
  description: "Fetches recent life logs from the local database.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Number of logs to fetch." },
      dateFrom: { type: "string", description: "Optional start date in YYYY-MM-DD." },
      dateTo: { type: "string", description: "Optional end date in YYYY-MM-DD." },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const limit = (input.limit as number) || 10;
    const logs = await getLifeLogs(
      chatId,
      limit,
      input.dateFrom as string | undefined,
      input.dateTo as string | undefined,
    );
    if (logs.length === 0) return "No life logs found for that range.";
    return JSON.stringify(logs, null, 2);
  },
});

registerTool({
  name: "update_life_log",
  description: "Updates an existing life log row in the local database.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "The ID of the life log to update." },
      logDate: { type: "string" },
      startTime: { type: "string" },
      endTime: { type: "string" },
      durationMinutes: { type: "number" },
      category: { type: "string" },
      description: { type: "string" },
    },
    required: ["id"],
  },
  execute: async (input) => {
    await updateLifeLog(input.id as number, {
      logDate: input.logDate as string | undefined,
      startTime: input.startTime as string | undefined,
      endTime: input.endTime as string | undefined,
      durationMinutes: input.durationMinutes as number | undefined,
      category: input.category as string | undefined,
      description: input.description as string | undefined,
    });
    return `✅ Successfully updated life log ID ${input.id}.`;
  },
});

registerTool({
  name: "delete_life_log",
  description: "Deletes a life log row from the local database.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "The ID of the life log to delete." },
    },
    required: ["id"],
  },
  execute: async (input) => {
    await deleteLifeLog(input.id as number);
    return `🗑️ Successfully deleted life log ID ${input.id}.`;
  },
});

registerTool({
  name: "summarize_work_logs",
  description: "Summarize local daily work logs for a date range. Defaults to today.",
  parameters: {
    type: "object",
    properties: {
      dateFrom: { type: "string", description: "Optional start date in YYYY-MM-DD format." },
      dateTo: { type: "string", description: "Optional end date in YYYY-MM-DD format." },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const { date } = getISTDateTime();
    const dFrom = (input.dateFrom as string) || date;
    const dTo = (input.dateTo as string) || dFrom;
    
    const result = await summarizeWorkLogs(chatId, dFrom, dTo);
    return JSON.stringify(result, null, 2);
  },
});

registerTool({
  name: "summarize_life_logs",
  description: "Summarize local life logs for a date range. Defaults to today.",
  parameters: {
    type: "object",
    properties: {
      dateFrom: { type: "string", description: "Optional start date in YYYY-MM-DD format." },
      dateTo: { type: "string", description: "Optional end date in YYYY-MM-DD format." },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const { date } = getISTDateTime();
    const dFrom = (input.dateFrom as string) || date;
    const dTo = (input.dateTo as string) || dFrom;
    
    const result = await summarizeLifeLogs(chatId, dFrom, dTo);
    return JSON.stringify(result, null, 2);
  },
});

// ── Level/EXP Tools ────────────────────────────────────────────

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
