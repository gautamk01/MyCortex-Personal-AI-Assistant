/** Format ISO date string to time in IST (e.g. "02:30 PM") */
export function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString + "Z");
    return d.toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

/** Format ISO date string to short date in IST (e.g. "Mar 29") */
export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString + "Z");
    return d.toLocaleDateString("en-US", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/** Format ISO date string to full date (e.g. "Mar 29, 2026") */
export function formatFullDate(isoString: string): string {
  try {
    const d = new Date(isoString + "Z");
    return d.toLocaleDateString("en-US", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

/** Convert cron expression to human-readable string */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  if (min === "*" && hour === "*") return "Every minute";
  if (hour === "*" && min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (dom === "*" && mon === "*" && dow === "*") {
    if (min !== "*" && hour !== "*") return `Daily at ${hour}:${min.padStart(2, "0")}`;
    if (hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;
  }
  if (dow !== "*" && dom === "*" && mon === "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayName = days[Number(dow)] ?? dow;
    return `${dayName} at ${hour}:${min.padStart(2, "0")}`;
  }

  return cron;
}

/** Minimal classname joiner — avoids adding clsx dependency */
export function clsx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Format milliseconds to human-readable duration */
export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Format minutes to human-readable duration */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
