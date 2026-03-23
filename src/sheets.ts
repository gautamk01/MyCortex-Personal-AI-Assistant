import { google, sheets_v4 } from "googleapis";
import { config } from "./config.js";

const LEETCODE_SHEET_TITLE = "LeetCode Log";
const COMPANY_SHEET_TITLE = "Company Tracker";

const LEETCODE_HEADERS = [
  "#",
  "Date",
  "Time (IST)",
  "Problem",
  "Difficulty",
  "Topic",
  "Time Spent (mins)",
  "Notes",
  "Revision Date",
];

type SheetsClient = ReturnType<typeof google.sheets>;
type SpreadsheetMetadata = {
  sheets: SheetsClient;
  spreadsheet: sheets_v4.Schema$Spreadsheet;
};

let sheetsClientPromise: Promise<SheetsClient> | null = null;
let spreadsheetMetadataPromise: Promise<SpreadsheetMetadata> | null = null;
const verifiedSheetTabs = new Set<string>();

function getSheetVerificationKey(title: string, headers: string[]): string {
  return JSON.stringify([title, headers]);
}

function invalidateSpreadsheetMetadata(): void {
  spreadsheetMetadataPromise = null;
  verifiedSheetTabs.clear();
}

async function getSheetsClient() {
  if (sheetsClientPromise) {
    return sheetsClientPromise;
  }

  sheetsClientPromise = (async () => {
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
  })();

  try {
    return await sheetsClientPromise;
  } catch (error) {
    sheetsClientPromise = null;
    throw error;
  }
}

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function formatTime12Hour(hours: number, minutes: number): string {
  const period = hours >= 12 ? "PM" : "AM";
  let h = hours % 12;
  if (h === 0) h = 12;
  return `${pad2(h)}:${pad2(minutes)} ${period}`;
}

export function getISTDateTime(): { date: string; time: string } {
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

  let parsedHour = parseInt(hour, 10);
  if (parsedHour === 24) parsedHour = 0;

  return {
    date: `${year}-${month}-${day}`,
    time: formatTime12Hour(parsedHour, parseInt(minute, 10)),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

async function getSpreadsheetMetadata() {
  if (!spreadsheetMetadataPromise) {
    spreadsheetMetadataPromise = (async () => {
      const sheets = await getSheetsClient();
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: config.googleSheetId,
      });
      return { sheets, spreadsheet: spreadsheet.data };
    })();
  }

  try {
    return await spreadsheetMetadataPromise;
  } catch (error) {
    spreadsheetMetadataPromise = null;
    throw error;
  }
}

async function getSheetIdByTitle(title: string): Promise<number | null> {
  const { spreadsheet } = await getSpreadsheetMetadata();
  const sheet = spreadsheet.sheets?.find((item) => item.properties?.title === title);
  return sheet?.properties?.sheetId ?? null;
}

async function ensureSheetTab(title: string, headers: string[]): Promise<void> {
  const verificationKey = getSheetVerificationKey(title, headers);
  if (verifiedSheetTabs.has(verificationKey)) {
    return;
  }

  const { sheets, spreadsheet } = await getSpreadsheetMetadata();
  const spreadsheetId = config.googleSheetId;

  const existing = spreadsheet.sheets?.find((item) => item.properties?.title === title);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
    invalidateSpreadsheetMetadata();
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

  verifiedSheetTabs.add(verificationKey);
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

function validateTimeMinutes(timeMinutes: number): number {
  if (!Number.isFinite(timeMinutes) || timeMinutes <= 0) {
    throw new Error("timeMinutes must be a positive number.");
  }
  return Math.round(timeMinutes);
}

// ── LeetCode Logs ──────────────────────────────────────────────

export async function logLeetCodeToSheet(
  problemName: string,
  difficulty: "Easy" | "Medium" | "Hard",
  topic: string,
  timeMinutes: number,
  notes = "",
  revisionDate = "",
) {
  await ensureSheetTab(LEETCODE_SHEET_TITLE, LEETCODE_HEADERS);

  const sheets = await getSheetsClient();
  const { date, time } = getISTDateTime();
  const serialNo = await getNextSerialNo(LEETCODE_SHEET_TITLE);
  const duration = validateTimeMinutes(timeMinutes);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(LEETCODE_SHEET_TITLE)}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[serialNo, date, time, problemName, difficulty, topic, duration, notes, revisionDate]],
    },
  });

  return response.data;
}

export async function getLeetCodeLogs(limit = 10) {
  await ensureSheetTab(LEETCODE_SHEET_TITLE, LEETCODE_HEADERS);

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(LEETCODE_SHEET_TITLE)}!A:I`,
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
      notes: row[7] || "",
      revisionDate: row[8] || "",
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
    notes?: string;
    revisionDate?: string;
  },
) {
  await ensureSheetTab(LEETCODE_SHEET_TITLE, LEETCODE_HEADERS);

  const sheets = await getSheetsClient();
  const range = `${quoteSheet(LEETCODE_SHEET_TITLE)}!A${rowNumber}:I${rowNumber}`;
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
    updates.notes ?? existingRow[7] ?? "",
    updates.revisionDate ?? existingRow[8] ?? "",
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

// ── Company / Job Tracker ──────────────────────────────────────

const COMPANY_HEADERS = [
  "#",
  "Date",
  "Company",
  "Role",
  "Status",
  "Platform",
  "Link",
  "Notes",
];

export type CompanyStatus =
  | "Interested"
  | "Applied"
  | "OA"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Withdrawn"
  | "Accepted";

export async function logCompanyToSheet(
  company: string,
  role: string,
  status: CompanyStatus,
  platform: string,
  link = "",
  notes = "",
) {
  await ensureSheetTab(COMPANY_SHEET_TITLE, COMPANY_HEADERS);

  const sheets = await getSheetsClient();
  const { date } = getISTDateTime();
  const serialNo = await getNextSerialNo(COMPANY_SHEET_TITLE);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(COMPANY_SHEET_TITLE)}!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[serialNo, date, company, role, status, platform, link, notes]],
    },
  });

  return response.data;
}

export async function getCompanyLogs(limit = 10) {
  await ensureSheetTab(COMPANY_SHEET_TITLE, COMPANY_HEADERS);

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: `${quoteSheet(COMPANY_SHEET_TITLE)}!A:H`,
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
      company: row[2],
      role: row[3],
      status: row[4],
      platform: row[5],
      link: row[6],
      notes: row[7],
    };
  });
}

export async function updateCompanyLog(
  rowNumber: number,
  updates: {
    company?: string;
    role?: string;
    status?: CompanyStatus;
    platform?: string;
    link?: string;
    notes?: string;
  },
) {
  await ensureSheetTab(COMPANY_SHEET_TITLE, COMPANY_HEADERS);

  const sheets = await getSheetsClient();
  const range = `${quoteSheet(COMPANY_SHEET_TITLE)}!A${rowNumber}:H${rowNumber}`;
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
    updates.company ?? existingRow[2],
    updates.role ?? existingRow[3],
    updates.status ?? existingRow[4],
    updates.platform ?? existingRow[5],
    updates.link ?? existingRow[6],
    updates.notes ?? existingRow[7],
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

export async function deleteCompanyLog(rowNumber: number) {
  await ensureSheetTab(COMPANY_SHEET_TITLE, COMPANY_HEADERS);
  await deleteRowFromSheet(COMPANY_SHEET_TITLE, rowNumber);
  return true;
}
