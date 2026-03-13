import { TodoistApi } from "@doist/todoist-api-typescript";
import { config } from "./config.js";

let api: TodoistApi | null = null;

function getApi(): TodoistApi {
  if (!api) {
    if (!config.todoistApiToken) {
      throw new Error("TODOIST_API_TOKEN is not configured.");
    }
    api = new TodoistApi(config.todoistApiToken);
  }
  return api;
}

/**
 * Fetch all active tasks scheduled for today or earlier.
 */
export async function getTodayTasks() {
  const client = getApi();
  const response = await client.getTasksByFilter({ query: "today | overdue" });
  return response.results.map(t => ({
    id: t.id,
    content: t.content,
    priority: t.priority,
    due: t.due?.date || "No Date",
    url: t.url
  }));
}

/**
 * Add a new task to the Inbox.
 */
export async function addTask(content: string, dueString: string = "today", priority: number = 1) {
  const client = getApi();
  const task = await client.addTask({
    content,
    dueString,
    priority,
  });
  return { id: task.id, content: task.content, due: task.due?.date, url: task.url };
}

/**
 * Complete a task by ID.
 */
export async function completeTask(taskId: string) {
  const client = getApi();
  await client.closeTask(taskId);
  return true;
}
