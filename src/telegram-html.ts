export const TELEGRAM_HTML_PARSE_MODE = "HTML" as const;

const TELEGRAM_MESSAGE_LIMIT = 4096;
const ALLOWED_TAG_REGEX = /<\/?(?:b|i|strong|em)\s*>/gi;

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function convertMarkdownishToHtml(text: string): string {
  const lineConverted = text
    .replace(/\r\n/g, "\n")
    .replace(/```([\s\S]*?)```/g, (_match, code: string) => code.trim())
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^\s*[-*+]\s+(.+)$/gm, "• $1")
    .replace(/^\s*(\d+)\.\s+(.+)$/gm, "$1. $2")
    .replace(/^\s*---+\s*$/gm, "");

  return lineConverted
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<b><i>$1</i></b>")
    .replace(/___([^_]+)___/g, "<b><i>$1</i></b>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_]+)__/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<i>$1</i>");
}

function normalizeMarkup(text: string): string {
  return convertMarkdownishToHtml(
    text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p>/gi, ""),
  );
}

function canonicalizeTag(token: string): { tag: "b" | "i"; closing: boolean } {
  const lower = token.toLowerCase();
  const closing = lower.startsWith("</");
  const tag = lower.includes("i") || lower.includes("em") ? "i" : "b";
  return { tag, closing };
}

export function sanitizeTelegramHtml(text: string): string {
  const normalized = normalizeMarkup(text);
  const stack: Array<"b" | "i"> = [];
  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of normalized.matchAll(ALLOWED_TAG_REGEX)) {
    const index = match.index ?? 0;
    parts.push(escapeTelegramHtml(normalized.slice(lastIndex, index)));

    const token = match[0];
    const { tag, closing } = canonicalizeTag(token);

    if (!closing) {
      if (stack[stack.length - 1] !== tag) {
        parts.push(`<${tag}>`);
        stack.push(tag);
      }
    } else if (stack.includes(tag)) {
      const reopen: Array<"b" | "i"> = [];
      while (stack.length > 0) {
        const top = stack.pop() as "b" | "i";
        parts.push(`</${top}>`);
        if (top === tag) {
          break;
        }
        reopen.push(top);
      }
      for (let i = reopen.length - 1; i >= 0; i -= 1) {
        const reopenTag = reopen[i];
        parts.push(`<${reopenTag}>`);
        stack.push(reopenTag);
      }
    }

    lastIndex = index + token.length;
  }

  parts.push(escapeTelegramHtml(normalized.slice(lastIndex)));

  while (stack.length > 0) {
    parts.push(`</${stack.pop() as "b" | "i"}>`);
  }

  return parts.join("");
}

function decodeTelegramHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function stripTelegramHtml(text: string): string {
  return decodeTelegramHtmlEntities(
    sanitizeTelegramHtml(text)
      .replace(/<\/?(?:b|i)>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function splitPlainText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

export function prepareTelegramHtmlChunks(
  text: string,
  maxLength: number = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  const sanitized = sanitizeTelegramHtml(text);
  if (sanitized.length <= maxLength) {
    return [sanitized];
  }

  const plainText = stripTelegramHtml(sanitized);
  return splitPlainText(plainText, maxLength).map((chunk) => escapeTelegramHtml(chunk));
}
