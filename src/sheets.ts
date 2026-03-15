import { google } from "googleapis";
import { config } from "./config.js";

const LEETCODE_SHEET_TITLE = "LeetCode Log";
const WORK_LOG_SHEET_TITLE = "Daily Work Log";
const LIFE_LOG_SHEET_TITLE = "Life Log";

const LEETCODE_HEADERS = [
  "#",
  "Date",
  "Time (IST)",
  "Problem",
  "Difficulty",
  "Topic",
  "Time Spent (mins)",
];

const WORK_LOG_HEADERS = [
  "#",
  "Date",
  "Time (IST)",
  "Work Title",
  "Category",
  "Tag",
  "Duration (mins)",
  "Output",
  "Notes",
  "EXP",
];

const LIFE_LOG_HEADERS = [
  "#",
  "Start Date (IST)",
  "Start Time (IST)",
  "End Date (IST)",
  "End Time (IST)",
  "Duration (mins)",
  "Activity",
  "Category",
  "Tag",
  "Entry Type",
  "Source",
  "Notes",
];

export type WorkCategory =
  | "studying"
  | "development"
  | "project"
  | "reading"
  | "research"
  | "fun"
  | "movies"
  | "gaming"
  | "scrolling"
  | "admin"
  | "health"
  | "other";

export type LifeCategory =
  | "sleep"
  | "study"
  | "development"
  | "work"
  | "meal"
  | "exercise"
  | "travel"
  | "break"
  | "entertainment"
  | "personal"
  | "admin"
  | "other";

export type LifeEntryType = "point" | "session" | "open_session";
export type LifeSource = "manual" | "auto_split" | "live";

const PRODUCTIVE_CATEGORIES = new Set<WorkCategory>([
  "studying",
  "development",
  "project",
  "reading",
  "research",
]);

const NEGATIVE_CATEGORIES = new Set<WorkCategory>([
  "fun",
  "movies",
  "gaming",
  "scrolling",
]);

const NEUTRAL_CATEGORIES = new Set<WorkCategory>([
  "admin",
  "health",
  "other",
]);

const LIFE_CATEGORIES = new Set<LifeCategory>([
  "sleep",
  "study",
  "development",
  "work",
  "meal",
  "exercise",
  "travel",
  "break",
  "entertainment",
  "personal",
  "admin",
  "other",
]);

const LIFE_ENTRY_TYPES = new Set<LifeEntryType>(["point", "session", "open_session"]);
const LIFE_SOURCES = new Set<LifeSource>(["manual", "auto_split", "live"]);

async function getSheetsClient() {
  if (!config.googleSheetId) {
    throw new Error("GOOGLE_SHEET_ID is not configured in .env");
  }

  const authOptions: ConstructorParameters<typeof google.auth.GoogleAuth>[0] = {
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  };

  if (config.googleCredentialsJson) {
    let credentials: {
      client_email?: string;
      private_key?: string;
      [key: string]: unknown;
    };

    try {
      credentials = JSON.parse(config.googleCredentialsJson) as {
        client_email?: string;
        private_key?: string;
        [key: string]: unknown;
      };
    } catch {
      throw new Error("GOOGLE_CREDENTIALS_JSON is not valid JSON.");
    }

    if (typeof credentials.private_key === "string") {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }

    authOptions.credentials = credentials;
  } else if (config.googleCredentialsPath) {
    authOptions.keyFile = config.googleCredentialsPath;
  } else {
    throw new Error(
      "Google Sheets credentials are not configured. Set GOOGLE_CREDENTIALS_JSON for cloud deploys or GOOGLE_CREDENTIALS_PATH for local runs.",
    );
  }

  const auth = new google.auth.GoogleAuth(authOptions);

  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client as never });
}

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function getISTDateTime(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!year || !month || !day || !hour || !minute) {
    throw new Error("Could not determine current IST date/time.");
  }

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

function parseTimeToMinutes(time: string): number {
  const normalized = time.trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`Time "${time}" must be in HH:MM 24-hour format.`);
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Time "${time}" is not a valid HH:MM 24-hour time.`);
  }

  return hours * 60 + minutes;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function addOneDay(date: string): string {
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + 1);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

function normalizeDate(date?: string): string {
  const fallback = getISTDateTime().date;
  const normalized = (date ?? fallback).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Date "${normalized}" must be in YYYY-MM-DD format.`);
  }

  const utc = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(utc.getTime())) {
    throw new Error(`Date "${normalized}" is invalid.`);
  }

  return normalized;
}

function normalizeTime(time?: string): string | undefined {
  if (!time) return undefined;
  parseTimeToMinutes(time);
  return time.trim();
}

function normalizeLifeCategory(category: string): LifeCategory {
  const normalized = category.trim().toLowerCase() as LifeCategory;
  if (!LIFE_CATEGORIES.has(normalized)) {
    throw new Error(`Unsupported life log category: "${category}".`);
  }
  return normalized;
}

function normalizeLifeEntryType(entryType: string): LifeEntryType {
  const normalized = entryType.trim().toLowerCase() as LifeEntryType;
  if (!LIFE_ENTRY_TYPES.has(normalized)) {
    throw new Error(`Unsupported life log entry type: "${entryType}".`);
  }
  return normalized;
}

function normalizeLifeSource(source: string): LifeSource {
  const normalized = source.trim().toLowerCase() as LifeSource;
  if (!LIFE_SOURCES.has(normalized)) {
    throw new Error(`Unsupported life log source: "${source}".`);
  }
  return normalized;
}

function calculateDurationMinutes(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
): number {
  const start = new Date(`${startDate}T${startTime}:00+05:30`);
  const end = new Date(`${endDate}T${endTime}:00+05:30`);
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) {
    throw new Error("End time must be after start time.");
  }
  return Math.round(diffMs / 60000);
}

function resolveLifeTiming(input: {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  durationMinutes?: number;
  entryType?: LifeEntryType;
}): {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  durationMinutes: number;
  entryType: LifeEntryType;
} | {
  startDate: string;
  startTime: string;
  endDate: "";
  endTime: "";
  durationMinutes: "";
  entryType: LifeEntryType;
} {
  const fallback = getISTDateTime();
  const startDate = normalizeDate(input.startDate);
  const startTime = normalizeTime(input.startTime) ?? fallback.time;
  const requestedType = input.entryType ? normalizeLifeEntryType(input.entryType) : undefined;
  const endTime = normalizeTime(input.endTime);
  const hasDuration = input.durationMinutes !== undefined;
  const hasEnd = Boolean(endTime);

  if (requestedType === "point" && (hasEnd || hasDuration)) {
    throw new Error('Point life events cannot include an end time or duration.');
  }

  if (requestedType === "session" && !hasEnd && !hasDuration) {
    throw new Error('Session life events must include an end time or a duration.');
  }

  if (requestedType === "open_session") {
    return {
      startDate,
      startTime,
      endDate: "",
      endTime: "",
      durationMinutes: "",
      entryType: "open_session",
    };
  }

  if (!hasEnd && !hasDuration) {
    return {
      startDate,
      startTime,
      endDate: "",
      endTime: "",
      durationMinutes: "",
      entryType: requestedType ?? "point",
    };
  }

  if (hasDuration) {
    const durationMinutes = validateTimeMinutes(input.durationMinutes as number);
    const startMins = parseTimeToMinutes(startTime);
    const endTotal = startMins + durationMinutes;
    const dayOffset = Math.floor(endTotal / (24 * 60));
    const endMins = endTotal % (24 * 60);
    let endDate = startDate;
    for (let i = 0; i < dayOffset; i += 1) {
      endDate = addOneDay(endDate);
    }
    return {
      startDate,
      startTime,
      endDate,
      endTime: `${pad2(Math.floor(endMins / 60))}:${pad2(endMins % 60)}`,
      durationMinutes,
      entryType: "session",
    };
  }

  let endDate = normalizeDate(input.endDate ?? startDate);
  if (!input.endDate && parseTimeToMinutes(endTime as string) < parseTimeToMinutes(startTime)) {
    endDate = addOneDay(startDate);
  }

  return {
    startDate,
    startTime,
    endDate,
    endTime: endTime as string,
    durationMinutes: calculateDurationMinutes(startDate, startTime, endDate, endTime as string),
    entryType: "session",
  };
}

async function getSpreadsheetMetadata() {
  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: config.googleSheetId,
  });
  return { sheets, spreadsheet };
}

async function getSheetIdByTitle(title: string): Promise<number | null> {
  const { spreadsheet } = await getSpreadsheetMetadata();
  const sheet = spreadsheet.data.sheets?.find((item) => item.properties?.title === title);
  return sheet?.properties?.sheetId ?? null;
}

async function ensureSheetTab(title: string, headers: string[]): Promise<void> {
  const { sheets, spreadsheet } = await getSpreadsheetMetadata();
  const spreadsheetId = config.googleSheetId;

  const existing = spreadsheet.data.sheets?.find((item) => item.properties?.title === title);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }

  const headerRange = `${quoteSheet(title)}!A1:${String.fromCharCode(64 + headers.length)}1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  const currentHeaders = res.data.values?.[0] ?? [];
  const matches =
    currentHeaders.length === headers.length &&
    currentHeaders.every((value, index) => value === headers[index]);

  if (!matches) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [headers],
      },
    });
  }
}

async function getNextSerialNo(sheetTitle: string): Promise<number> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(sheetTitle)}!A:A`,
  });
  const rows = res.data.values || [];
  return Math.max(rows.length, 1);
}

async function deleteRowFromSheet(sheetTitle: string, rowNumber: number): Promise<void> {
  const sheets = await getSheetsClient();
  const sheetId = await getSheetIdByTitle(sheetTitle);
  if (sheetId === null) {
    throw new Error(`Sheet "${sheetTitle}" was not found.`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.googleSheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}

function durationMagnitude(timeMinutes: number): number {
  if (timeMinutes < 20) return 0;
  if (timeMinutes < 45) return 5;
  if (timeMinutes < 75) return 10;
  if (timeMinutes < 105) return 15;
  return 20;
}

function normalizeWorkCategory(category: string): WorkCategory {
  const normalized = category.trim().toLowerCase() as WorkCategory;
  if (
    PRODUCTIVE_CATEGORIES.has(normalized) ||
    NEGATIVE_CATEGORIES.has(normalized) ||
    NEUTRAL_CATEGORIES.has(normalized)
  ) {
    return normalized;
  }
  throw new Error(`Unsupported work category: "${category}".`);
}

function validateTimeMinutes(timeMinutes: number): number {
  if (!Number.isFinite(timeMinutes) || timeMinutes <= 0) {
    throw new Error("timeMinutes must be a positive number.");
  }
  return Math.round(timeMinutes);
}

export function calculateWorkSessionExp(category: string, timeMinutes: number): number {
  const normalized = normalizeWorkCategory(category);
  const magnitude = durationMagnitude(validateTimeMinutes(timeMinutes));

  if (PRODUCTIVE_CATEGORIES.has(normalized)) return magnitude;
  if (NEGATIVE_CATEGORIES.has(normalized)) return -magnitude;
  return 0;
}

export async function logLeetCodeToSheet(
  problemName: string,
  difficulty: "Easy" | "Medium" | "Hard",
  topic: string,
  timeMinutes: number,
  _notes = "",
) {
  await ensureSheetTab(LEETCODE_SHEET_TITLE, LEETCODE_HEADERS);

  const sheets = await getSheetsClient();
  const { date, time } = getISTDateTime();
  const serialNo = await getNextSerialNo(LEETCODE_SHEET_TITLE);
  const duration = validateTimeMinutes(timeMinutes);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(LEETCODE_SHEET_TITLE)}!A:G`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[serialNo, date, time, problemName, difficulty, topic, duration]],
    },
  });

  return response.data;
}

export async function getLeetCodeLogs(limit = 10) {
  await ensureSheetTab(LEETCODE_SHEET_TITLE, LEETCODE_HEADERS);

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(LEETCODE_SHEET_TITLE)}!A:G`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  const dataRows = rows.slice(1);
  const recent = dataRows.slice(-limit);

  return recent.map((row, index) => {
    const originalIndex = dataRows.length - recent.length + index;
    const rowNumber = originalIndex + 2;
    return {
      rowNumber,
      serialNo: row[0],
      date: row[1],
      time: row[2],
      problemName: row[3],
      difficulty: row[4],
      topic: row[5],
      timeMinutes: row[6],
    };
  });
}

export async function updateLeetCodeLog(
  rowNumber: number,
  updates: {
    problemName?: string;
    difficulty?: "Easy" | "Medium" | "Hard";
    topic?: string;
    timeMinutes?: number;
  },
) {
  await ensureSheetTab(LEETCODE_SHEET_TITLE, LEETCODE_HEADERS);

  const sheets = await getSheetsClient();
  const range = `${quoteSheet(LEETCODE_SHEET_TITLE)}!A${rowNumber}:G${rowNumber}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range,
  });

  const existingRow = res.data.values?.[0];
  if (!existingRow) {
    throw new Error(`Row ${rowNumber} not found or empty.`);
  }

  const newRow = [
    existingRow[0],
    existingRow[1],
    existingRow[2],
    updates.problemName ?? existingRow[3],
    updates.difficulty ?? existingRow[4],
    updates.topic ?? existingRow[5],
    updates.timeMinutes ?? existingRow[6],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [newRow],
    },
  });

  return true;
}

export async function deleteLeetCodeLog(rowNumber: number) {
  await ensureSheetTab(LEETCODE_SHEET_TITLE, LEETCODE_HEADERS);
  await deleteRowFromSheet(LEETCODE_SHEET_TITLE, rowNumber);
  return true;
}

export async function logWorkSessionToSheet(
  workTitle: string,
  category: WorkCategory,
  tag: string,
  timeMinutes: number,
  output = "",
  notes = "",
) {
  await ensureSheetTab(WORK_LOG_SHEET_TITLE, WORK_LOG_HEADERS);

  const normalizedCategory = normalizeWorkCategory(category);
  const duration = validateTimeMinutes(timeMinutes);
  const sheets = await getSheetsClient();
  const { date, time } = getISTDateTime();
  const serialNo = await getNextSerialNo(WORK_LOG_SHEET_TITLE);
  const exp = calculateWorkSessionExp(normalizedCategory, duration);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(WORK_LOG_SHEET_TITLE)}!A:J`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        serialNo,
        date,
        time,
        workTitle,
        normalizedCategory,
        tag,
        duration,
        output,
        notes,
        exp,
      ]],
    },
  });

  return {
    data: response.data,
    exp,
    category: normalizedCategory,
  };
}

export async function getWorkLogs(limit = 10) {
  await ensureSheetTab(WORK_LOG_SHEET_TITLE, WORK_LOG_HEADERS);

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(WORK_LOG_SHEET_TITLE)}!A:J`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  const dataRows = rows.slice(1);
  const recent = dataRows.slice(-limit);

  return recent.map((row, index) => {
    const originalIndex = dataRows.length - recent.length + index;
    const rowNumber = originalIndex + 2;
    return {
      rowNumber,
      serialNo: row[0],
      date: row[1],
      time: row[2],
      workTitle: row[3],
      category: row[4],
      tag: row[5],
      timeMinutes: Number(row[6] ?? 0),
      output: row[7] ?? "",
      notes: row[8] ?? "",
      exp: Number(row[9] ?? 0),
    };
  });
}

export async function updateWorkLog(
  rowNumber: number,
  updates: {
    workTitle?: string;
    category?: WorkCategory;
    tag?: string;
    timeMinutes?: number;
    output?: string;
    notes?: string;
  },
) {
  await ensureSheetTab(WORK_LOG_SHEET_TITLE, WORK_LOG_HEADERS);

  const sheets = await getSheetsClient();
  const range = `${quoteSheet(WORK_LOG_SHEET_TITLE)}!A${rowNumber}:J${rowNumber}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range,
  });

  const existingRow = res.data.values?.[0];
  if (!existingRow) {
    throw new Error(`Row ${rowNumber} not found or empty.`);
  }

  const nextCategory = updates.category ? normalizeWorkCategory(updates.category) : existingRow[4];
  const nextDuration = updates.timeMinutes !== undefined
    ? validateTimeMinutes(updates.timeMinutes)
    : existingRow[6];
  const newRow = [
    existingRow[0],
    existingRow[1],
    existingRow[2],
    updates.workTitle ?? existingRow[3],
    nextCategory,
    updates.tag ?? existingRow[5],
    nextDuration,
    updates.output ?? existingRow[7],
    updates.notes ?? existingRow[8],
    existingRow[9],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [newRow],
    },
  });

  return true;
}

export async function deleteWorkLog(rowNumber: number) {
  await ensureSheetTab(WORK_LOG_SHEET_TITLE, WORK_LOG_HEADERS);
  await deleteRowFromSheet(WORK_LOG_SHEET_TITLE, rowNumber);
  return true;
}

export async function summarizeWorkLogs(
  dateFrom?: string,
  dateTo?: string,
) {
  await ensureSheetTab(WORK_LOG_SHEET_TITLE, WORK_LOG_HEADERS);

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(WORK_LOG_SHEET_TITLE)}!A:J`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) {
    return {
      logs: [],
      totalsByCategory: {},
      totalsByTag: {},
      totalMinutes: 0,
      totalExp: 0,
      dateFrom: dateFrom ?? getISTDateTime().date,
      dateTo: dateTo ?? dateFrom ?? getISTDateTime().date,
    };
  }

  const today = getISTDateTime().date;
  const start = dateFrom ?? today;
  const end = dateTo ?? start;

  const logs = rows
    .slice(1)
    .map((row) => ({
      date: row[1],
      category: row[4],
      tag: row[5] ?? "",
      timeMinutes: Number(row[6] ?? 0),
      exp: Number(row[9] ?? 0),
    }))
    .filter((row) => row.date >= start && row.date <= end);

  const totalsByCategory: Record<string, number> = {};
  const totalsByTag: Record<string, number> = {};
  let totalMinutes = 0;
  let totalExp = 0;

  for (const log of logs) {
    totalsByCategory[log.category] = (totalsByCategory[log.category] ?? 0) + log.timeMinutes;
    if (log.tag) {
      totalsByTag[log.tag] = (totalsByTag[log.tag] ?? 0) + log.timeMinutes;
    }
    totalMinutes += log.timeMinutes;
    totalExp += log.exp;
  }

  return {
    logs,
    totalsByCategory,
    totalsByTag,
    totalMinutes,
    totalExp,
    dateFrom: start,
    dateTo: end,
  };
}

type LifeLogRow = {
  rowNumber: number;
  serialNo: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  durationMinutes: number | null;
  activity: string;
  category: LifeCategory;
  tag: string;
  entryType: LifeEntryType;
  source: LifeSource;
  notes: string;
};

function mapLifeLogRow(row: string[], rowNumber: number): LifeLogRow {
  return {
    rowNumber,
    serialNo: row[0] ?? "",
    startDate: row[1] ?? "",
    startTime: row[2] ?? "",
    endDate: row[3] ?? "",
    endTime: row[4] ?? "",
    durationMinutes: row[5] ? Number(row[5]) : null,
    activity: row[6] ?? "",
    category: normalizeLifeCategory(row[7] ?? "other"),
    tag: row[8] ?? "",
    entryType: normalizeLifeEntryType(row[9] ?? "point"),
    source: normalizeLifeSource(row[10] ?? "manual"),
    notes: row[11] ?? "",
  };
}

async function getAllLifeLogRows(): Promise<LifeLogRow[]> {
  await ensureSheetTab(LIFE_LOG_SHEET_TITLE, LIFE_LOG_HEADERS);

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(LIFE_LOG_SHEET_TITLE)}!A:L`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  return rows.slice(1).map((row, index) => mapLifeLogRow(row, index + 2));
}

async function updateLifeLogRow(rowNumber: number, row: string[]): Promise<void> {
  const sheets = await getSheetsClient();
  const range = `${quoteSheet(LIFE_LOG_SHEET_TITLE)}!A${rowNumber}:L${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });
}

export async function logLifeEventToSheet(input: {
  activity: string;
  category: LifeCategory;
  tag?: string;
  notes?: string;
  source?: LifeSource;
  entryType?: LifeEntryType;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  durationMinutes?: number;
}) {
  await ensureSheetTab(LIFE_LOG_SHEET_TITLE, LIFE_LOG_HEADERS);

  if (!input.activity.trim()) {
    throw new Error("activity is required.");
  }

  const timing = resolveLifeTiming({
    startDate: input.startDate,
    startTime: input.startTime,
    endDate: input.endDate,
    endTime: input.endTime,
    durationMinutes: input.durationMinutes,
    entryType: input.entryType,
  });

  const sheets = await getSheetsClient();
  const serialNo = await getNextSerialNo(LIFE_LOG_SHEET_TITLE);
  const category = normalizeLifeCategory(input.category);
  const source = normalizeLifeSource(input.source ?? "manual");

  const row = [
    serialNo,
    timing.startDate,
    timing.startTime,
    timing.endDate,
    timing.endTime,
    timing.durationMinutes === "" ? "" : timing.durationMinutes,
    input.activity.trim(),
    category,
    input.tag?.trim() ?? "",
    timing.entryType,
    source,
    input.notes?.trim() ?? "",
  ];

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(LIFE_LOG_SHEET_TITLE)}!A:L`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });

  return {
    data: response.data,
    row: mapLifeLogRow(row.map((value) => String(value)), serialNo + 1),
  };
}

export async function getOpenLifeSession() {
  const rows = await getAllLifeLogRows();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].entryType === "open_session") {
      return rows[index];
    }
  }

  return null;
}

export async function startLifeSession(input: {
  activity: string;
  category: LifeCategory;
  tag?: string;
  notes?: string;
  startDate?: string;
  startTime?: string;
}) {
  const now = getISTDateTime();
  const startDate = normalizeDate(input.startDate ?? now.date);
  const startTime = normalizeTime(input.startTime) ?? now.time;
  const openSession = await getOpenLifeSession();
  let autoClosedRowNumber: number | null = null;

  if (openSession) {
    const closedTiming = resolveLifeTiming({
      startDate: openSession.startDate,
      startTime: openSession.startTime,
      endDate: startDate,
      endTime: startTime,
    });

    await updateLifeLogRow(openSession.rowNumber, [
      openSession.serialNo,
      openSession.startDate,
      openSession.startTime,
      closedTiming.endDate,
      closedTiming.endTime,
      String(closedTiming.durationMinutes),
      openSession.activity,
      openSession.category,
      openSession.tag,
      "session",
      openSession.source,
      openSession.notes,
    ]);

    autoClosedRowNumber = openSession.rowNumber;
  }

  const created = await logLifeEventToSheet({
    activity: input.activity,
    category: input.category,
    tag: input.tag,
    notes: input.notes,
    source: "live",
    entryType: "open_session",
    startDate,
    startTime,
  });

  return {
    autoClosedRowNumber,
    row: created.row,
  };
}

export async function endLifeSession(input?: {
  endDate?: string;
  endTime?: string;
  notes?: string;
}) {
  await ensureSheetTab(LIFE_LOG_SHEET_TITLE, LIFE_LOG_HEADERS);

  const openSession = await getOpenLifeSession();
  if (!openSession) {
    throw new Error("No open life session found.");
  }

  const now = getISTDateTime();
  const timing = resolveLifeTiming({
    startDate: openSession.startDate,
    startTime: openSession.startTime,
    endDate: input?.endDate ?? now.date,
    endTime: input?.endTime ?? now.time,
  });

  const nextNotes = [openSession.notes, input?.notes?.trim()].filter(Boolean).join(" | ");

  await updateLifeLogRow(openSession.rowNumber, [
    openSession.serialNo,
    openSession.startDate,
    openSession.startTime,
    timing.endDate,
    timing.endTime,
    String(timing.durationMinutes),
    openSession.activity,
    openSession.category,
    openSession.tag,
    "session",
    openSession.source,
    nextNotes,
  ]);

  return {
    ...openSession,
    endDate: timing.endDate,
    endTime: timing.endTime,
    durationMinutes: timing.durationMinutes,
    entryType: "session" as const,
    notes: nextNotes,
  };
}

export async function getLifeLogs(limit = 10, dateFrom?: string, dateTo?: string) {
  const rows = await getAllLifeLogRows();
  const today = getISTDateTime().date;
  const start = normalizeDate(dateFrom ?? dateTo ?? today);
  const end = normalizeDate(dateTo ?? dateFrom ?? today);
  const filtered = rows.filter((row) => {
    return row.startDate >= start && row.startDate <= end;
  });

  return filtered.slice(-limit);
}

export async function updateLifeLog(
  rowNumber: number,
  updates: {
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    durationMinutes?: number;
    activity?: string;
    category?: LifeCategory;
    tag?: string;
    entryType?: LifeEntryType;
    source?: LifeSource;
    notes?: string;
  },
) {
  await ensureSheetTab(LIFE_LOG_SHEET_TITLE, LIFE_LOG_HEADERS);

  const sheets = await getSheetsClient();
  const range = `${quoteSheet(LIFE_LOG_SHEET_TITLE)}!A${rowNumber}:L${rowNumber}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range,
  });

  const existingRow = res.data.values?.[0];
  if (!existingRow) {
    throw new Error(`Row ${rowNumber} not found or empty.`);
  }

  const current = mapLifeLogRow(existingRow, rowNumber);
  const shouldCloseOpenSession = current.entryType === "open_session" && (
    updates.endDate !== undefined ||
    updates.endTime !== undefined ||
    updates.durationMinutes !== undefined
  );
  const requestedEntryType = updates.entryType ?? (shouldCloseOpenSession ? "session" : current.entryType);
  const nextEndDate = updates.endDate ?? (current.endDate || undefined);
  const nextEndTime = updates.endTime ?? (current.endTime || undefined);

  const timing = resolveLifeTiming({
    startDate: updates.startDate ?? current.startDate,
    startTime: updates.startTime ?? current.startTime,
    endDate: nextEndDate,
    endTime: nextEndTime,
    durationMinutes: updates.durationMinutes,
    entryType: requestedEntryType,
  });

  await updateLifeLogRow(rowNumber, [
    current.serialNo,
    timing.startDate,
    timing.startTime,
    timing.endDate,
    timing.endTime,
    timing.durationMinutes === "" ? "" : String(timing.durationMinutes),
    updates.activity?.trim() ?? current.activity,
    updates.category ? normalizeLifeCategory(updates.category) : current.category,
    updates.tag?.trim() ?? current.tag,
    timing.entryType,
    updates.source ? normalizeLifeSource(updates.source) : current.source,
    updates.notes?.trim() ?? current.notes,
  ]);

  return true;
}

export async function deleteLifeLog(rowNumber: number) {
  await ensureSheetTab(LIFE_LOG_SHEET_TITLE, LIFE_LOG_HEADERS);
  await deleteRowFromSheet(LIFE_LOG_SHEET_TITLE, rowNumber);
  return true;
}

export async function summarizeLifeLogs(dateFrom?: string, dateTo?: string) {
  const today = getISTDateTime().date;
  const start = normalizeDate(dateFrom ?? today);
  const end = normalizeDate(dateTo ?? start);
  const rows = (await getAllLifeLogRows())
    .filter((row) => row.startDate >= start && row.startDate <= end)
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      return a.startTime.localeCompare(b.startTime);
    });

  const totalsByCategory: Record<string, number> = {};
  const timeline = rows.map((row) => ({
    rowNumber: row.rowNumber,
    startDate: row.startDate,
    startTime: row.startTime,
    endDate: row.endDate,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    activity: row.activity,
    category: row.category,
    tag: row.tag,
    entryType: row.entryType,
    source: row.source,
  }));

  let totalMinutes = 0;
  let focusedMinutes = 0;
  let breakMinutes = 0;
  let entertainmentMinutes = 0;
  let wakeUpTime: string | null = null;

  for (const row of rows) {
    if (row.durationMinutes !== null) {
      totalsByCategory[row.category] = (totalsByCategory[row.category] ?? 0) + row.durationMinutes;
      totalMinutes += row.durationMinutes;

      if (row.category === "study" || row.category === "development" || row.category === "work") {
        focusedMinutes += row.durationMinutes;
      }

      if (row.category === "break") {
        breakMinutes += row.durationMinutes;
      }

      if (row.category === "entertainment") {
        entertainmentMinutes += row.durationMinutes;
      }
    }

    if (wakeUpTime === null && /wake|woke/i.test(row.activity)) {
      wakeUpTime = row.startTime;
    }
  }

  return {
    dateFrom: start,
    dateTo: end,
    timeline,
    totalsByCategory,
    totalMinutes,
    focusedMinutes,
    breakMinutes,
    entertainmentMinutes,
    wakeUpTime,
    openSession: await getOpenLifeSession(),
  };
}
