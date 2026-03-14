import { registerTool } from "./index.js";
import { getDailySummary, listDailySummaries } from "../coach.js";

registerTool({
  name: "get_daily_summary",
  description: "Fetch a stored daily summary for a specific date in YYYY-MM-DD format.",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "Date in YYYY-MM-DD format." },
    },
    required: ["date"],
  },
  execute: async (input) => {
    const summary = getDailySummary(input.__chatId as number, input.date as string);
    if (!summary) {
      return `No daily summary found for ${input.date as string}.`;
    }

    return JSON.stringify({
      summaryDate: summary.summaryDate,
      summaryText: summary.summaryText,
      metrics: JSON.parse(summary.metricsJson),
    }, null, 2);
  },
});

registerTool({
  name: "list_daily_summaries",
  description: "List recent stored daily summaries for the current chat.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "How many summaries to return. Default 7." },
    },
    required: [],
  },
  execute: async (input) => {
    const summaries = listDailySummaries(input.__chatId as number, (input.limit as number) || 7);
    if (summaries.length === 0) {
      return "No daily summaries stored yet.";
    }

    return JSON.stringify(
      summaries.map((summary) => ({
        summaryDate: summary.summaryDate,
        summaryText: summary.summaryText,
      })),
      null,
      2,
    );
  },
});
