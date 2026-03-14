import { logLeetCodeToSheet, logWorkSessionToSheet, logLifeEventToSheet } from "./sheets.js";

function normalizeClockTime(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (minute < 0 || minute > 59) return null;

  if (meridiem === "am") {
    if (hour === 12) hour = 0;
  } else if (meridiem === "pm") {
    if (hour < 12) hour += 12;
  }

  if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function compactTag(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
}

export async function attemptAutoLog(chatId: number, userMessage: string): Promise<string | null> {
  const text = userMessage.trim();

  const wakeMatch = text.match(/\b(?:i\s+)?woke up at\s+([0-9: ]+(?:am|pm)?)/i);
  if (wakeMatch) {
    const startTime = normalizeClockTime(wakeMatch[1]);
    if (startTime) {
      await logLifeEventToSheet({
        activity: "Woke up",
        category: "sleep",
        entryType: "point",
        source: "manual",
        startTime,
      });
      return `Auto-logged in Life Log: woke up at ${startTime}.`;
    }
  }

  const leetcodeMatch = text.match(
    /\b(?:i\s+)?(?:solved|did)\s+(.+?)\s+in\s+(\d+)\s*(?:minutes|min|mins)\b.*\b(easy|medium|hard)\b(?:.*(?:topic|topics?)[: -]+([a-z0-9 ,/_-]+))?/i,
  );
  if (leetcodeMatch) {
    const problemName = compactTag(leetcodeMatch[1]);
    const timeMinutes = Number(leetcodeMatch[2]);
    const difficulty = `${leetcodeMatch[3][0].toUpperCase()}${leetcodeMatch[3].slice(1).toLowerCase()}` as "Easy" | "Medium" | "Hard";
    const topic = compactTag(leetcodeMatch[4] ?? "general");
    await logLeetCodeToSheet(problemName, difficulty, topic, timeMinutes);
    return `Auto-logged in LeetCode Log: ${problemName} (${difficulty}, ${timeMinutes} mins).`;
  }

  const workPatterns: Array<{
    regex: RegExp;
    category: "studying" | "development" | "reading" | "research" | "movies" | "gaming";
    title: (value: string) => string;
  }> = [
    {
      regex: /\b(?:i\s+)?(?:studied|studying)\s+(.+?)\s+for\s+(\d+)\s*(?:minutes|min|mins)\b/i,
      category: "studying",
      title: (value) => `Studied ${value}`,
    },
    {
      regex: /\b(?:i\s+)?(?:worked on|built|developed|coded)\s+(.+?)\s+for\s+(\d+)\s*(?:minutes|min|mins)\b/i,
      category: "development",
      title: (value) => `Worked on ${value}`,
    },
    {
      regex: /\b(?:i\s+)?read\s+(.+?)\s+for\s+(\d+)\s*(?:minutes|min|mins)\b/i,
      category: "reading",
      title: (value) => `Read ${value}`,
    },
    {
      regex: /\b(?:i\s+)?researched\s+(.+?)\s+for\s+(\d+)\s*(?:minutes|min|mins)\b/i,
      category: "research",
      title: (value) => `Researched ${value}`,
    },
    {
      regex: /\b(?:i\s+)?(?:watched|watching)\s+(.+?)\s+for\s+(\d+)\s*(?:minutes|min|mins)\b/i,
      category: "movies",
      title: (value) => `Watched ${value}`,
    },
    {
      regex: /\b(?:i\s+)?(?:played|gaming)\s+(.+?)\s+for\s+(\d+)\s*(?:minutes|min|mins)\b/i,
      category: "gaming",
      title: (value) => `Played ${value}`,
    },
  ];

  for (const pattern of workPatterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    const tag = compactTag(match[1]);
    const timeMinutes = Number(match[2]);
    await logWorkSessionToSheet(
      pattern.title(tag),
      pattern.category,
      tag,
      timeMinutes,
    );
    return `Auto-logged in Daily Work Log: ${pattern.title(tag)} for ${timeMinutes} mins.`;
  }

  return null;
}
