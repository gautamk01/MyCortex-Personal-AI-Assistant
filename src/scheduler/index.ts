import cron from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { registerTool } from "../tools/index.js";

// ── Types ──────────────────────────────────────────────────────

interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  action: string;
  chatId: number;
  paused: boolean;
  createdAt: string;
  task: cron.ScheduledTask;
}

// ── In-memory task store ───────────────────────────────────────

const tasks = new Map<string, ScheduledTask>();

// ── Callback for when a task fires ─────────────────────────────
// Set by the index.ts wiring. When a cron job fires, this callback
// sends a message into the agent loop.

type TaskCallback = (chatId: number, message: string) => Promise<void>;
let onTaskFire: TaskCallback | null = null;

export function setSchedulerCallback(cb: TaskCallback): void {
  onTaskFire = cb;
}

// ── Shutdown & Global Controls ───────────────────────────────────

export function stopAllTasks(): void {
  for (const t of tasks.values()) {
    t.task.stop();
  }
  tasks.clear();
}

export function pauseAllTasks(): void {
  for (const t of tasks.values()) {
    t.task.stop();
  }
}

export function resumeAllTasks(): void {
  for (const t of tasks.values()) {
    if (!t.paused) {
      t.task.start();
    }
  }
}

// ── Tools ──────────────────────────────────────────────────────

registerTool({
  name: "schedule_task",
  description:
    "Schedule a recurring task using a cron expression. " +
    "The task will fire periodically and send a message to the current chat. " +
    "Cron format: minute hour day-of-month month day-of-week " +
    "(e.g. '*/5 * * * *' for every 5 minutes, '0 9 * * 1-5' for 9am weekdays).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable name for this task" },
      cron_expression: {
        type: "string",
        description: "Cron expression (e.g. '*/5 * * * *' for every 5 minutes)",
      },
      action: {
        type: "string",
        description: "What the task should do when it fires (description/instruction)",
      },
      chat_id: {
        type: "number",
        description: "Telegram chat ID to send the result to",
      },
    },
    required: ["name", "cron_expression", "action", "chat_id"],
  },
  execute: async (input) => {
    const name = input.name as string;
    const cronExpr = input.cron_expression as string;
    const action = input.action as string;
    const chatId = input.chat_id as number;

    if (!cron.validate(cronExpr)) {
      return JSON.stringify({ error: `Invalid cron expression: "${cronExpr}"` });
    }

    const id = uuidv4().slice(0, 8);

    const task = cron.schedule(cronExpr, async () => {
      console.log(`⏰ Scheduled task "${name}" (${id}) fired`);
      if (onTaskFire) {
        await onTaskFire(chatId, `[Scheduled Task "${name}"] ${action}`).catch((err) =>
          console.error(`❌ Scheduler callback error:`, err)
        );
      }
    });

    tasks.set(id, {
      id,
      name,
      cronExpression: cronExpr,
      action,
      chatId,
      paused: false,
      createdAt: new Date().toISOString(),
      task,
    });

    return JSON.stringify({
      success: true,
      id,
      name,
      cronExpression: cronExpr,
      action,
      message: `Task "${name}" scheduled with ID ${id}`,
    });
  },
});

registerTool({
  name: "list_scheduled_tasks",
  description: "List all scheduled tasks with their status, cron expression, and details.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const list = Array.from(tasks.values()).map(
      ({ id, name, cronExpression, action, chatId, paused, createdAt }) => ({
        id,
        name,
        cronExpression,
        action,
        chatId,
        paused,
        createdAt,
      })
    );
    return JSON.stringify({ tasks: list, count: list.length });
  },
});

registerTool({
  name: "pause_task",
  description: "Pause a scheduled task by its ID. The task remains but won't fire until resumed.",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task ID to pause" },
    },
    required: ["task_id"],
  },
  execute: async (input) => {
    const id = input.task_id as string;
    const t = tasks.get(id);
    if (!t) return JSON.stringify({ error: `Task "${id}" not found` });

    t.task.stop();
    t.paused = true;
    return JSON.stringify({ success: true, id, name: t.name, status: "paused" });
  },
});

registerTool({
  name: "resume_task",
  description: "Resume a paused scheduled task by its ID.",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task ID to resume" },
    },
    required: ["task_id"],
  },
  execute: async (input) => {
    const id = input.task_id as string;
    const t = tasks.get(id);
    if (!t) return JSON.stringify({ error: `Task "${id}" not found` });

    t.task.start();
    t.paused = false;
    return JSON.stringify({ success: true, id, name: t.name, status: "running" });
  },
});

registerTool({
  name: "delete_task",
  description: "Delete a scheduled task by its ID. The task is stopped and removed permanently.",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task ID to delete" },
    },
    required: ["task_id"],
  },
  execute: async (input) => {
    const id = input.task_id as string;
    const t = tasks.get(id);
    if (!t) return JSON.stringify({ error: `Task "${id}" not found` });

    t.task.stop();
    tasks.delete(id);
    return JSON.stringify({ success: true, id, name: t.name, status: "deleted" });
  },
});
