import { registerTool } from "./index.js";

registerTool({
  name: "get_current_time",
  description:
    "Returns the current date and time in ISO 8601 format with the local timezone offset. Use this when the user asks what time it is, or when you need to know the current date/time.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const now = new Date();
    return JSON.stringify({
      iso: now.toISOString(),
      local: now.toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unix: Math.floor(now.getTime() / 1000),
    });
  },
});
