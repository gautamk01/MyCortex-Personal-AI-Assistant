import { addTask, completeTask, getTodayTasks } from "./todoist.js";
import { getDb } from "./memory/sqlite.js";

export type DailyPlanCategory =
  | "class"
  | "assignment"
  | "revision"
  | "coding"
  | "health"
  | "admin"
  | "other";

export type DailyPlanPriority = "must" | "should" | "could";
export type DailyPlanStatus = "planned" | "in_progress" | "done" | "skipped";

export interface DailyPlanItemInput {
  title: string;
  category?: string;
  priority?: string;
  timeBlock?: string;
}

export interface DailyPlanItem {
  id: number;
  planId: number;
  chatId: number;
  title: string;
  category: DailyPlanCategory;
  priority: DailyPlanPriority;
  status: DailyPlanStatus;
  timeBlock: string;
  todoistTaskId: string;
  todoistUrl: string;
  reflection: string;
  sortOrder: number;
}

export interface DailyPlan {
  id: number;
  chatId: number;
  planDate: string;
  status: string;
  items: DailyPlanItem[];
}

interface PlanRow {
  id: number;
  chatId: number;
  planDate: string;
  status: string;
}

const VALID_CATEGORIES = new Set<DailyPlanCategory>([
  "class",
  "assignment",
  "revision",
  "coding",
  "health",
  "admin",
  "other",
]);

const VALID_PRIORITIES = new Set<DailyPlanPriority>(["must", "should", "could"]);
const VALID_STATUSES = new Set<DailyPlanStatus>(["planned", "in_progress", "done", "skipped"]);

export function getTodayPlanDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not determine today's plan date.");
  }

  return `${year}-${month}-${day}`;
}

function normalizePlanDate(planDate?: string): string {
  if (!planDate) return getTodayPlanDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    throw new Error("planDate must use YYYY-MM-DD format.");
  }
  return planDate;
}

function normalizeCategory(category?: string): DailyPlanCategory {
  const normalized = (category ?? "other").trim().toLowerCase() as DailyPlanCategory;
  return VALID_CATEGORIES.has(normalized) ? normalized : "other";
}

function normalizePriority(priority?: string): DailyPlanPriority {
  const normalized = (priority ?? "should").trim().toLowerCase() as DailyPlanPriority;
  return VALID_PRIORITIES.has(normalized) ? normalized : "should";
}

function normalizeStatus(status?: string): DailyPlanStatus {
  const normalized = (status ?? "planned").trim().toLowerCase() as DailyPlanStatus;
  return VALID_STATUSES.has(normalized) ? normalized : "planned";
}

function priorityWeight(priority: DailyPlanPriority): number {
  return priority === "must" ? 4 : priority === "should" ? 3 : 1;
}

function titleWithPriority(item: DailyPlanItem): string {
  const label = item.priority === "must" ? "[Must]" : item.priority === "should" ? "[Should]" : "[Could]";
  return `${label} ${item.title}`;
}

function loadPlanItems(planId: number): DailyPlanItem[] {
  return getDb()
    .prepare(`
      SELECT id, planId, chatId, title, category, priority, status, timeBlock,
             todoistTaskId, todoistUrl, reflection, sortOrder
      FROM daily_plan_items
      WHERE planId = ?
      ORDER BY
        CASE priority WHEN 'must' THEN 1 WHEN 'should' THEN 2 ELSE 3 END,
        sortOrder ASC,
        id ASC
    `)
    .all(planId) as DailyPlanItem[];
}

function loadPlan(chatId: number, planDate: string): DailyPlan | null {
  const row = getDb()
    .prepare(`
      SELECT id, chatId, planDate, status
      FROM daily_plans
      WHERE chatId = ? AND planDate = ?
    `)
    .get(chatId, planDate) as PlanRow | undefined;

  if (!row) return null;

  return {
    ...row,
    items: loadPlanItems(row.id),
  };
}

function ensurePlanRow(chatId: number, planDate: string): number {
  getDb()
    .prepare(`
      INSERT INTO daily_plans (chatId, planDate, status, updatedAt)
      VALUES (?, ?, 'active', datetime('now'))
      ON CONFLICT(chatId, planDate) DO UPDATE SET
        status = 'active',
        updatedAt = datetime('now')
    `)
    .run(chatId, planDate);

  const row = getDb()
    .prepare("SELECT id FROM daily_plans WHERE chatId = ? AND planDate = ?")
    .get(chatId, planDate) as { id: number } | undefined;

  if (!row) {
    throw new Error("Could not create or load the daily plan.");
  }

  return row.id;
}

function requireItem(chatId: number, itemId: number): DailyPlanItem {
  const row = getDb()
    .prepare(`
      SELECT id, planId, chatId, title, category, priority, status, timeBlock,
             todoistTaskId, todoistUrl, reflection, sortOrder
      FROM daily_plan_items
      WHERE id = ? AND chatId = ?
    `)
    .get(itemId, chatId) as DailyPlanItem | undefined;

  if (!row) {
    throw new Error(`No daily plan item found with ID ${itemId}.`);
  }

  return row;
}

function ensurePlanShape(items: DailyPlanItemInput[]): void {
  if (items.length === 0) {
    throw new Error("A daily plan needs at least one item.");
  }

  const mustCount = items.filter((item) => normalizePriority(item.priority) === "must").length;
  if (mustCount > 3) {
    throw new Error("A daily plan can have at most 3 must-do items.");
  }
}

export function createDailyPlan(
  chatId: number,
  items: DailyPlanItemInput[],
  planDate?: string,
): DailyPlan {
  const normalizedDate = normalizePlanDate(planDate);
  ensurePlanShape(items);
  const planId = ensurePlanRow(chatId, normalizedDate);

  const tx = getDb().transaction(() => {
    getDb().prepare("DELETE FROM daily_plan_items WHERE planId = ?").run(planId);

    const insert = getDb().prepare(`
      INSERT INTO daily_plan_items (
        planId, chatId, title, category, priority, status, timeBlock, sortOrder, updatedAt
      ) VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, datetime('now'))
    `);

    items.forEach((item, index) => {
      const title = item.title.trim();
      if (!title) return;
      insert.run(
        planId,
        chatId,
        title,
        normalizeCategory(item.category),
        normalizePriority(item.priority),
        (item.timeBlock ?? "").trim(),
        index + 1,
      );
    });
  });

  tx();

  const plan = loadPlan(chatId, normalizedDate);
  if (!plan || plan.items.length === 0) {
    throw new Error("The daily plan was created without any valid items.");
  }

  return plan;
}

export function getDailyPlan(chatId: number, planDate?: string): DailyPlan | null {
  return loadPlan(chatId, normalizePlanDate(planDate));
}

export function updateDailyPlanItem(
  chatId: number,
  itemId: number,
  updates: {
    title?: string;
    category?: string;
    priority?: string;
    status?: string;
    timeBlock?: string;
    reflection?: string;
  },
): DailyPlanItem {
  const item = requireItem(chatId, itemId);
  const nextTitle = updates.title !== undefined ? updates.title.trim() : item.title;
  if (!nextTitle) {
    throw new Error("Daily plan items need a non-empty title.");
  }

  const nextPriority = normalizePriority(updates.priority ?? item.priority);
  if (nextPriority === "must" && item.priority !== "must") {
    const mustCount = getDb()
      .prepare(`
        SELECT COUNT(*) as count
        FROM daily_plan_items
        WHERE chatId = ? AND planId = ? AND priority = 'must' AND id != ?
      `)
      .get(chatId, item.planId, itemId) as { count: number };

    if (mustCount.count >= 3) {
      throw new Error("A daily plan can have at most 3 must-do items.");
    }
  }

  getDb()
    .prepare(`
      UPDATE daily_plan_items
      SET title = ?, category = ?, priority = ?, status = ?, timeBlock = ?, reflection = ?,
          updatedAt = datetime('now')
      WHERE id = ? AND chatId = ?
    `)
    .run(
      nextTitle,
      normalizeCategory(updates.category ?? item.category),
      nextPriority,
      normalizeStatus(updates.status ?? item.status),
      updates.timeBlock !== undefined ? updates.timeBlock.trim() : item.timeBlock,
      updates.reflection !== undefined ? updates.reflection.trim() : item.reflection,
      itemId,
      chatId,
    );

  return requireItem(chatId, itemId);
}

export async function completeDailyPlanItem(
  chatId: number,
  itemId: number,
  syncTodoist = true,
): Promise<DailyPlanItem> {
  const item = requireItem(chatId, itemId);

  if (item.status !== "done") {
    updateDailyPlanItem(chatId, itemId, { status: "done" });
  }

  if (syncTodoist && item.todoistTaskId) {
    try {
      await completeTask(item.todoistTaskId);
    } catch (err) {
      console.warn(`⚠️  Could not close Todoist task ${item.todoistTaskId}:`, err);
    }
  }

  return requireItem(chatId, itemId);
}

export async function completeDailyPlanItemByTodoistTaskId(
  chatId: number,
  todoistTaskId: string,
): Promise<DailyPlanItem | null> {
  const item = getDb()
    .prepare(`
      SELECT id, planId, chatId, title, category, priority, status, timeBlock,
             todoistTaskId, todoistUrl, reflection, sortOrder
      FROM daily_plan_items
      WHERE chatId = ? AND todoistTaskId = ?
      ORDER BY updatedAt DESC
      LIMIT 1
    `)
    .get(chatId, todoistTaskId) as DailyPlanItem | undefined;

  if (!item) return null;
  if (item.status === "done") return item;
  return completeDailyPlanItem(chatId, item.id, false);
}

export async function syncDailyPlanToTodoist(chatId: number, planDate?: string): Promise<DailyPlan> {
  const plan = getDailyPlan(chatId, planDate);
  if (!plan) {
    throw new Error("No daily plan found to sync.");
  }

  for (const item of plan.items) {
    if (item.todoistTaskId || item.status === "skipped" || item.status === "done") continue;

    const dueString = plan.planDate === getTodayPlanDate() ? "today" : plan.planDate;
    const created = await addTask(titleWithPriority(item), dueString, priorityWeight(item.priority));

    getDb()
      .prepare(`
        UPDATE daily_plan_items
        SET todoistTaskId = ?, todoistUrl = ?, updatedAt = datetime('now')
        WHERE id = ? AND chatId = ?
      `)
      .run(String(created.id), created.url ?? "", item.id, chatId);
  }

  const refreshed = getDailyPlan(chatId, plan.planDate);
  if (!refreshed) {
    throw new Error("Could not reload the synced daily plan.");
  }
  return refreshed;
}

export async function reconcileDailyPlanWithTodoist(chatId: number, planDate?: string): Promise<DailyPlan | null> {
  const normalizedDate = normalizePlanDate(planDate);
  const plan = getDailyPlan(chatId, normalizedDate);
  if (!plan || normalizedDate !== getTodayPlanDate()) {
    return plan;
  }

  const openTasks = await getTodayTasks();
  const openIds = new Set(openTasks.map((task) => String(task.id)));

  for (const item of plan.items) {
    if (!item.todoistTaskId) continue;
    if (item.status === "done" || item.status === "skipped") continue;
    if (!openIds.has(item.todoistTaskId)) {
      updateDailyPlanItem(chatId, item.id, { status: "done" });
    }
  }

  return getDailyPlan(chatId, normalizedDate);
}

export function getDailyPlanContext(chatId: number): string {
  const plan = getDailyPlan(chatId);
  if (!plan || plan.items.length === 0) return "";

  const lines = plan.items.map((item) => {
    const block = item.timeBlock ? ` @ ${item.timeBlock}` : "";
    return `- [${item.priority}/${item.status}] ${item.title}${block}`;
  });

  return `\n## Today's Plan (${plan.planDate})\n${lines.join("\n")}`;
}

export function getDailyPlanStats(plan: DailyPlan | null): {
  total: number;
  done: number;
  skipped: number;
  mustTotal: number;
  mustDone: number;
  openMusts: DailyPlanItem[];
} {
  if (!plan) {
    return {
      total: 0,
      done: 0,
      skipped: 0,
      mustTotal: 0,
      mustDone: 0,
      openMusts: [],
    };
  }

  const done = plan.items.filter((item) => item.status === "done").length;
  const skipped = plan.items.filter((item) => item.status === "skipped").length;
  const musts = plan.items.filter((item) => item.priority === "must");
  const mustDone = musts.filter((item) => item.status === "done").length;
  const openMusts = musts.filter((item) => item.status !== "done");

  return {
    total: plan.items.length,
    done,
    skipped,
    mustTotal: musts.length,
    mustDone,
    openMusts,
  };
}

export function formatDailyPlan(plan: DailyPlan | null): string {
  if (!plan || plan.items.length === 0) {
    return `No daily plan saved for ${plan?.planDate ?? getTodayPlanDate()}.`;
  }

  const sections: DailyPlanPriority[] = ["must", "should", "could"];
  const header = [`Plan for ${plan.planDate}`, ""];

  for (const priority of sections) {
    const items = plan.items.filter((item) => item.priority === priority);
    if (items.length === 0) continue;

    const label = priority === "must" ? "Must" : priority === "should" ? "Should" : "Could";
    header.push(`${label}`);

    for (const item of items) {
      const status =
        item.status === "done"
          ? "done"
          : item.status === "in_progress"
            ? "in progress"
            : item.status === "skipped"
              ? "skipped"
              : "planned";
      const block = item.timeBlock ? ` @ ${item.timeBlock}` : "";
      header.push(`- #${item.id} [${status}] ${item.title}${block}`);
    }

    header.push("");
  }

  return header.join("\n").trim();
}
