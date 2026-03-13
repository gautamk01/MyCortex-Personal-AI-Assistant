import { google } from "googleapis";
import { config } from "./config.js";

const LEETCODE_SHEET_TITLE = "LeetCode Log";
const WORK_LOG_SHEET_TITLE = "Daily Work Log";

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

async function getSheetsClient() {
  if (!config.googleSheetId) {
    throw new Error("GOOGLE_SHEET_ID is not configured in .env");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleCredentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

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
