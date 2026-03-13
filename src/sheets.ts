import { google } from "googleapis";
import { resolve } from "node:path";
import { config } from "./config.js";

async function getSheetsClient() {
  if (!config.googleSheetId) {
    throw new Error("GOOGLE_SHEET_ID is not configured in .env");
  }

  // Use the service account credentials file
  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleCredentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client as any });
}

/**
 * Get the current date and time in IST.
 */
function getISTDateTime(): { date: string; time: string } {
  const now = new Date();
  
  const dateOptions: Intl.DateTimeFormatOptions = { 
    timeZone: 'Asia/Kolkata', 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  };
  const timeOptions: Intl.DateTimeFormatOptions = { 
    timeZone: 'Asia/Kolkata', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  };
  
  // en-CA gives YYYY-MM-DD
  const dateStr = now.toLocaleDateString('en-CA', dateOptions);
  // en-GB gives HH:mm
  const timeStr = now.toLocaleTimeString('en-GB', timeOptions);
  
  return { date: dateStr, time: timeStr };
}

/**
 * Ensure the sheet has the correct headers on the first row.
 */
async function ensureHeaders() {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.googleSheetId;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "A1:G1",
  });

  const headers = res.data.values?.[0];
  if (!headers || headers.length === 0) {
    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "A1:G1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["#", "Date", "Time (IST)", "Problem", "Difficulty", "Topic", "Time Spent (mins)"]],
      },
    });
    console.log("📝 Initialized Google Sheet headers.");
  }
}

/**
 * Get the next serial number based on existing rows.
 */
async function getNextSerialNo(): Promise<number> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: "A:A",
  });
  const rows = res.data.values || [];
  // rows[0] is header, so serial = row count (excluding header)
  return Math.max(rows.length, 1);
}

/**
 * Logs a LeetCode problem to the Google Sheet.
 */
export async function logLeetCodeToSheet(
  problemName: string,
  difficulty: "Easy" | "Medium" | "Hard",
  topic: string,
  timeMinutes: number,
  notes: string = ""
) {
  await ensureHeaders();

  const sheets = await getSheetsClient();
  const { date, time } = getISTDateTime();
  const serialNo = await getNextSerialNo();

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: "A:G",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[serialNo, date, time, problemName, difficulty, topic, timeMinutes]],
    },
  });

  return response.data;
}

/**
 * Fetches recent LeetCode logs from the Google Sheet.
 */
export async function getLeetCodeLogs(limit: number = 10) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range: "A:G",
  });
  
  const rows = res.data.values || [];
  if (rows.length <= 1) return []; // Only headers or empty
  
  // Exclude headers, take the last `limit` rows
  const dataRows = rows.slice(1);
  const recent = dataRows.slice(-limit);
  
  return recent.map((row, index) => {
    // Calculate the actual row number in the sheet
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

/**
 * Updates a specific row in the Google Sheet.
 */
export async function updateLeetCodeLog(
  rowNumber: number,
  updates: {
    problemName?: string;
    difficulty?: "Easy" | "Medium" | "Hard";
    topic?: string;
    timeMinutes?: number;
  }
) {
  const sheets = await getSheetsClient();
  
  // First, get the existing row to merge updates
  const range = `A${rowNumber}:G${rowNumber}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetId,
    range,
  });
  
  const existingRow = res.data.values?.[0];
  if (!existingRow) throw new Error(`Row ${rowNumber} not found or empty.`);
  
  // Merge existing data with updates
  const newRow = [
    existingRow[0], // Serial No
    existingRow[1], // Date
    existingRow[2], // Time
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

/**
 * Deletes a specific row in the Google Sheet.
 */
export async function deleteLeetCodeLog(rowNumber: number) {
  const sheets = await getSheetsClient();
  
  // Get the sheet ID of the first tab
  const spreadRes = await sheets.spreadsheets.get({
    spreadsheetId: config.googleSheetId,
  });
  const sheetId = spreadRes.data.sheets?.[0]?.properties?.sheetId || 0;
  
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.googleSheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1, // 0-indexed, inclusive
              endIndex: rowNumber,       // 0-indexed, exclusive
            },
          },
        },
      ],
    },
  });
  
  return true;
}
