import { registerTool } from "./index.js";
import {
  cancelReminder,
  createReminder,
  describeReminder,
  listReminders,
  snoozeReminder,
} from "../reminders.js";

registerTool({
  name: "create_reminder",
  description:
    "Create a one-time Telegram reminder for a future date/time in IST. Use this for things like 'buy milk at 4 PM'.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "What the reminder is for." },
      date: { type: "string", description: "Optional date in YYYY-MM-DD format. Defaults to today in IST." },
      time: { type: "string", description: "Time in HH:MM 24-hour IST format." },
      notes: { type: "string", description: "Optional extra note for the reminder." },
    },
    required: ["text", "time"],
  },
  execute: async (input) => {
    const reminder = createReminder({
      chatId: input.__chatId as number,
      text: input.text as string,
      date: input.date as string | undefined,
      time: input.time as string,
      notes: input.notes as string | undefined,
    });

    return `⏰ Reminder set: ${describeReminder(reminder)}. This is temporary and will be lost if the bot restarts.`;
  },
});

registerTool({
  name: "list_reminders",
  description: "List active one-time reminders for the current chat.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (input) => {
    const reminders = listReminders(input.__chatId as number);
    if (reminders.length === 0) {
      return "No active reminders.";
    }

    return JSON.stringify(reminders, null, 2);
  },
});

registerTool({
  name: "cancel_reminder",
  description: "Cancel an active one-time reminder by ID.",
  parameters: {
    type: "object",
    properties: {
      reminder_id: { type: "string", description: "Reminder ID from list_reminders." },
    },
    required: ["reminder_id"],
  },
  execute: async (input) => {
    const reminder = cancelReminder(input.reminder_id as string);
    if (!reminder) {
      return `Reminder "${input.reminder_id as string}" was not found.`;
    }

    return `🗑️ Reminder cancelled: ${describeReminder(reminder)}.`;
  },
});

registerTool({
  name: "snooze_reminder",
  description: "Snooze an active one-time reminder by a number of minutes.",
  parameters: {
    type: "object",
    properties: {
      reminder_id: { type: "string", description: "Reminder ID from list_reminders." },
      minutes: { type: "number", description: "How many minutes to snooze it." },
    },
    required: ["reminder_id", "minutes"],
  },
  execute: async (input) => {
    const reminder = snoozeReminder(
      input.reminder_id as string,
      input.minutes as number,
    );

    if (!reminder) {
      return `Reminder "${input.reminder_id as string}" was not found.`;
    }

    return `😴 Reminder snoozed: ${describeReminder(reminder)}.`;
  },
});
