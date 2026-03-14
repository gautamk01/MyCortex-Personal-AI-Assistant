const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MAX_TIMEOUT_MS = 2_147_483_647;

export type ReminderStatus = "scheduled" | "done" | "cancelled";

export interface ReminderRecord {
  id: string;
  chatId: number;
  text: string;
  dueAtIso: string;
  createdAtIso: string;
  notes: string;
  status: ReminderStatus;
}

type ActiveReminder = ReminderRecord & {
  timeout: ReturnType<typeof setTimeout> | null;
};

type ReminderDispatch = (reminder: ReminderRecord) => Promise<void>;

const reminders = new Map<string, ActiveReminder>();
let onReminderDue: ReminderDispatch | null = null;

export function setReminderDispatch(callback: ReminderDispatch): void {
  onReminderDue = callback;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getISTNowParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  return { year, month, day, hour, minute };
}

function currentISTDate(): string {
  const { year, month, day } = getISTNowParts();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function validateDate(date: string): string {
  const normalized = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Date "${date}" must be in YYYY-MM-DD format.`);
  }

  const [year, month, day] = normalized.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error(`Date "${date}" is invalid.`);
  }

  return normalized;
}

function validateTime(time: string): string {
  const normalized = time.trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`Time "${time}" must be in HH:MM 24-hour format.`);
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Time "${time}" is invalid.`);
  }

  return normalized;
}

function buildISTDate(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hours, minutes) - IST_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs);
}

function formatReminderDateTime(dueAtIso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(dueAtIso));

  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value ?? "";

  return `${month} ${day}, ${year} ${hour}:${minute} ${dayPeriod} IST`;
}

function clearReminderTimeout(reminder: ActiveReminder): void {
  if (reminder.timeout) {
    clearTimeout(reminder.timeout);
    reminder.timeout = null;
  }
}

async function fireReminder(reminderId: string): Promise<void> {
  const reminder = reminders.get(reminderId);
  if (!reminder || reminder.status !== "scheduled") return;

  clearReminderTimeout(reminder);

  if (onReminderDue) {
    await onReminderDue({
      id: reminder.id,
      chatId: reminder.chatId,
      text: reminder.text,
      dueAtIso: reminder.dueAtIso,
      createdAtIso: reminder.createdAtIso,
      notes: reminder.notes,
      status: reminder.status,
    });
  }
}

function scheduleReminder(reminder: ActiveReminder): void {
  clearReminderTimeout(reminder);

  const dueMs = new Date(reminder.dueAtIso).getTime();
  const delayMs = dueMs - Date.now();
  if (delayMs <= 0) {
    reminder.timeout = setTimeout(() => {
      void fireReminder(reminder.id).catch((error) =>
        console.error(`❌ Reminder fire failed (${reminder.id}):`, error)
      );
    }, 0);
    return;
  }

  const waitMs = Math.min(delayMs, MAX_TIMEOUT_MS);
  reminder.timeout = setTimeout(() => {
    if (delayMs > MAX_TIMEOUT_MS) {
      scheduleReminder(reminder);
      return;
    }

    void fireReminder(reminder.id).catch((error) =>
      console.error(`❌ Reminder fire failed (${reminder.id}):`, error)
    );
  }, waitMs);
}

export function createReminder(input: {
  chatId: number;
  text: string;
  date?: string;
  time: string;
  notes?: string;
}): ReminderRecord {
  if (!input.text.trim()) {
    throw new Error("Reminder text is required.");
  }

  const date = validateDate(input.date ?? currentISTDate());
  const time = validateTime(input.time);
  const dueAt = buildISTDate(date, time);

  if (dueAt.getTime() <= Date.now()) {
    throw new Error("Reminder time must be in the future.");
  }

  const reminder: ActiveReminder = {
    id: randomId(),
    chatId: input.chatId,
    text: input.text.trim(),
    dueAtIso: dueAt.toISOString(),
    createdAtIso: new Date().toISOString(),
    notes: input.notes?.trim() ?? "",
    status: "scheduled",
    timeout: null,
  };

  reminders.set(reminder.id, reminder);
  scheduleReminder(reminder);

  return {
    id: reminder.id,
    chatId: reminder.chatId,
    text: reminder.text,
    dueAtIso: reminder.dueAtIso,
    createdAtIso: reminder.createdAtIso,
    notes: reminder.notes,
    status: reminder.status,
  };
}

export function listReminders(chatId: number): ReminderRecord[] {
  return Array.from(reminders.values())
    .filter((reminder) => reminder.chatId === chatId && reminder.status === "scheduled")
    .sort((a, b) => a.dueAtIso.localeCompare(b.dueAtIso))
    .map((reminder) => ({
      id: reminder.id,
      chatId: reminder.chatId,
      text: reminder.text,
      dueAtIso: reminder.dueAtIso,
      createdAtIso: reminder.createdAtIso,
      notes: reminder.notes,
      status: reminder.status,
    }));
}

export function getReminder(reminderId: string): ReminderRecord | null {
  const reminder = reminders.get(reminderId);
  if (!reminder) return null;

  return {
    id: reminder.id,
    chatId: reminder.chatId,
    text: reminder.text,
    dueAtIso: reminder.dueAtIso,
    createdAtIso: reminder.createdAtIso,
    notes: reminder.notes,
    status: reminder.status,
  };
}

export function cancelReminder(reminderId: string): ReminderRecord | null {
  const reminder = reminders.get(reminderId);
  if (!reminder) return null;

  reminder.status = "cancelled";
  clearReminderTimeout(reminder);
  reminders.delete(reminderId);
  return {
    id: reminder.id,
    chatId: reminder.chatId,
    text: reminder.text,
    dueAtIso: reminder.dueAtIso,
    createdAtIso: reminder.createdAtIso,
    notes: reminder.notes,
    status: reminder.status,
  };
}

export function markReminderDone(reminderId: string): ReminderRecord | null {
  const reminder = reminders.get(reminderId);
  if (!reminder) return null;

  reminder.status = "done";
  clearReminderTimeout(reminder);
  reminders.delete(reminderId);
  return {
    id: reminder.id,
    chatId: reminder.chatId,
    text: reminder.text,
    dueAtIso: reminder.dueAtIso,
    createdAtIso: reminder.createdAtIso,
    notes: reminder.notes,
    status: reminder.status,
  };
}

export function snoozeReminder(reminderId: string, minutes: number): ReminderRecord | null {
  const reminder = reminders.get(reminderId);
  if (!reminder) return null;

  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("Snooze minutes must be a positive number.");
  }

  const nextDue = new Date(Date.now() + Math.round(minutes) * 60 * 1000);
  reminder.dueAtIso = nextDue.toISOString();
  reminder.status = "scheduled";
  scheduleReminder(reminder);

  return {
    id: reminder.id,
    chatId: reminder.chatId,
    text: reminder.text,
    dueAtIso: reminder.dueAtIso,
    createdAtIso: reminder.createdAtIso,
    notes: reminder.notes,
    status: reminder.status,
  };
}

export function stopAllReminders(): void {
  for (const reminder of reminders.values()) {
    clearReminderTimeout(reminder);
  }
  reminders.clear();
}

export function describeReminder(reminder: ReminderRecord): string {
  return `${reminder.text} @ ${formatReminderDateTime(reminder.dueAtIso)}`;
}

export function getReminderDueLabel(reminder: ReminderRecord): string {
  return formatReminderDateTime(reminder.dueAtIso);
}
