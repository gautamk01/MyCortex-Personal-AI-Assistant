import {
  completeDailyPlanItem,
  createDailyPlan,
  formatDailyPlan,
  getDailyPlan,
  getDailyPlanStats,
  reconcileDailyPlanWithTodoist,
  syncDailyPlanToTodoist,
  updateDailyPlanItem,
} from "../daily-plan.js";
import { addExp } from "../memory/sqlite.js";
import { registerTool } from "./index.js";

registerTool({
  name: "create_daily_plan",
  description:
    "Create or replace the user's daily plan. Use for morning planning. Keep to at most 3 must-do items.",
  parameters: {
    type: "object",
    properties: {
      planDate: {
        type: "string",
        description: "Optional date in YYYY-MM-DD format. Defaults to today in Asia/Kolkata.",
      },
      items: {
        type: "array",
        description: "Daily plan items. Use categories like class, assignment, revision, coding, health, admin, other.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            category: {
              type: "string",
              description: "class | assignment | revision | coding | health | admin | other",
            },
            priority: {
              type: "string",
              description: "must | should | could. Limit must items to 3.",
            },
            timeBlock: {
              type: "string",
              description: "Optional time block like '8:00-9:00 AM' or 'After lunch'.",
            },
          },
          required: ["title"],
        },
      },
    },
    required: ["items"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const plan = createDailyPlan(
      chatId,
      (input.items as Array<{ title: string; category?: string; priority?: string; timeBlock?: string }>) ?? [],
      input.planDate as string | undefined,
    );
    return `Daily plan saved.\n\n${formatDailyPlan(plan)}`;
  },
});

registerTool({
  name: "get_daily_plan",
  description: "Fetch the saved daily plan for a specific date or for today.",
  parameters: {
    type: "object",
    properties: {
      planDate: {
        type: "string",
        description: "Optional date in YYYY-MM-DD format. Defaults to today in Asia/Kolkata.",
      },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    return formatDailyPlan(getDailyPlan(chatId, input.planDate as string | undefined));
  },
});

registerTool({
  name: "update_daily_plan_item",
  description: "Update a saved daily plan item by ID.",
  parameters: {
    type: "object",
    properties: {
      itemId: { type: "number", description: "The daily plan item ID." },
      title: { type: "string", description: "New title for the plan item." },
      category: { type: "string", description: "class | assignment | revision | coding | health | admin | other" },
      priority: { type: "string", description: "must | should | could" },
      status: { type: "string", description: "planned | in_progress | done | skipped" },
      timeBlock: { type: "string", description: "Optional time block." },
      reflection: { type: "string", description: "Optional reflection or reason." },
    },
    required: ["itemId"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const updated = updateDailyPlanItem(chatId, Number(input.itemId), {
      title: input.title as string | undefined,
      category: input.category as string | undefined,
      priority: input.priority as string | undefined,
      status: input.status as string | undefined,
      timeBlock: input.timeBlock as string | undefined,
      reflection: input.reflection as string | undefined,
    });

    return `Updated daily plan item #${updated.id}: [${updated.status}] ${updated.title}`;
  },
});

registerTool({
  name: "complete_daily_plan_item",
  description:
    "Mark a saved daily plan item as complete. If linked to Todoist, also closes the Todoist task and awards 10 EXP.",
  parameters: {
    type: "object",
    properties: {
      itemId: { type: "number", description: "The daily plan item ID." },
    },
    required: ["itemId"],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const item = await completeDailyPlanItem(chatId, Number(input.itemId));
    const exp = addExp(chatId, 10, `Completed daily plan item ${item.id}`);
    let message = `Completed plan item #${item.id}: "${item.title}". +10 EXP (Total: ${exp.newTotal}).`;
    if (exp.levelUp) {
      message += ` Level up -> ${exp.newLevel}.`;
    }
    return message;
  },
});

registerTool({
  name: "sync_daily_plan_to_todoist",
  description: "Create Todoist tasks for today's saved plan items that are not already linked.",
  parameters: {
    type: "object",
    properties: {
      planDate: {
        type: "string",
        description: "Optional date in YYYY-MM-DD format. Defaults to today in Asia/Kolkata.",
      },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const plan = await syncDailyPlanToTodoist(chatId, input.planDate as string | undefined);
    return `Todoist sync complete.\n\n${formatDailyPlan(plan)}`;
  },
});

registerTool({
  name: "run_evening_review",
  description: "Refresh today's plan from Todoist and return a strict execution summary for the day.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (input) => {
    const chatId = input.__chatId as number;
    const plan = await reconcileDailyPlanWithTodoist(chatId);
    const stats = getDailyPlanStats(plan);

    if (!plan || plan.items.length === 0) {
      return "No daily plan exists for today. Call out the lack of planning and push the user to plan tomorrow morning.";
    }

    const openMusts = stats.openMusts.length > 0
      ? stats.openMusts.map((item) => `- ${item.title}`).join("\n")
      : "None";

    return [
      `Evening review for ${plan.planDate}`,
      `Completed: ${stats.done}/${stats.total}`,
      `Must-dos done: ${stats.mustDone}/${stats.mustTotal}`,
      `Skipped: ${stats.skipped}`,
      "Open must-do items:",
      openMusts,
      "",
      formatDailyPlan(plan),
    ].join("\n");
  },
});
