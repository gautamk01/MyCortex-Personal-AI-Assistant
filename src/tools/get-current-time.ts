import { registerTool } from "./index.js";

registerTool({
  name: "get_current_time",
  description:
    "Returns the current date and time in ISO 8601 format, local timezone, and explicitly in IST (Indian Standard Time) with 12-hour AM/PM format. Use this when the user asks what time it is, or when you need to accurately log the time for a task.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const now = new Date();
    const istFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    return JSON.stringify({
      iso: now.toISOString(),
      local: now.toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ist_time: istFormatter.format(now),
      unix: Math.floor(now.getTime() / 1000),
    });
  },
});
