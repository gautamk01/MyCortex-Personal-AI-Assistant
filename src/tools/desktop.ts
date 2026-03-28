import { exec } from "node:child_process";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { registerTool } from "./index.js";

// ── Desktop Actions Tool ───────────────────────────────────────
// Opens GUI applications and interacts with visible terminal windows.
// Uses xdg-open, gnome-terminal, xdotool for real desktop interaction.

function run(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    exec(command, { timeout: 15000, env: { ...process.env } }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) rej(error);
      else res({ stdout: stdout.toString().trim(), stderr: stderr.toString().trim() });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Track the GUI terminal window ID per chat ──────────────────

const terminalWindows = new Map<number, string>(); // chatId → window ID

// ── open_terminal_gui ──────────────────────────────────────────

registerTool({
  name: "open_terminal_gui",
  description:
    "Open a real GUI terminal window on the user's desktop. " +
    "Use this when the user says 'open terminal', 'open a terminal', " +
    "'launch terminal'. After opening, use 'type_in_terminal' to " +
    "type commands into it that the user can see.",
  parameters: {
    type: "object",
    properties: {
      cwd: {
        type: "string",
        description: "Directory to open the terminal in (optional, defaults to home)",
      },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = ((input as Record<string, unknown>).__chatId as number) ?? 0;
    const cwd = (input.cwd as string) ?? process.env.HOME ?? "/";

    try {
      // Get list of terminal windows BEFORE opening a new one
      const { stdout: beforeList } = await run(
        `xdotool search --name "Terminal" 2>/dev/null || echo ""`
      ).catch(() => ({ stdout: "" }));
      const beforeIds = new Set(beforeList.split("\n").filter(Boolean));

      // Open gnome-terminal
      await run(`gnome-terminal --working-directory="${resolve(cwd)}" 2>/dev/null`).catch(
        async () => {
          await run(`x-terminal-emulator 2>/dev/null`);
        }
      );

      // Wait for the window to appear
      await sleep(1500);

      // Find the NEW terminal window ID
      const { stdout: afterList } = await run(
        `xdotool search --name "Terminal" 2>/dev/null || echo ""`
      ).catch(() => ({ stdout: "" }));
      const afterIds = afterList.split("\n").filter(Boolean);

      // The new window is the one that wasn't there before
      let windowId = afterIds.find((id) => !beforeIds.has(id));

      // Fallback: use the most recently active terminal
      if (!windowId && afterIds.length > 0) {
        windowId = afterIds[afterIds.length - 1];
      }

      if (!windowId) {
        // Last resort: get the active window
        const { stdout: activeId } = await run(`xdotool getactivewindow`);
        windowId = activeId;
      }

      if (windowId) {
        terminalWindows.set(chatId, windowId);
      }

      return JSON.stringify({
        success: true,
        message: `Terminal opened in ${resolve(cwd)}`,
        directory: resolve(cwd),
        windowId: windowId ?? "unknown",
        hint: "Use 'type_in_terminal' to type commands that are visible in this terminal.",
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to open terminal: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
});

// ── type_in_terminal ───────────────────────────────────────────

registerTool({
  name: "type_in_terminal",
  description:
    "Type text into the visible GUI terminal window. The user will see the text " +
    "being typed in real time. Use this to run commands in the terminal the user can see. " +
    "For example: type 'ls' to show directory listing, type 'cd /home' to change directory. " +
    "The command is automatically executed (Enter is pressed after typing).",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The command or text to type into the terminal",
      },
      press_enter: {
        type: "boolean",
        description: "Whether to press Enter after typing (default: true)",
      },
    },
    required: ["text"],
  },
  execute: async (input) => {
    const chatId = ((input as Record<string, unknown>).__chatId as number) ?? 0;
    const text = input.text as string;
    const pressEnter = (input.press_enter as boolean) ?? true;

    let windowId = terminalWindows.get(chatId);

    // If no tracked window, try to find any terminal window
    if (!windowId) {
      try {
        const { stdout } = await run(`xdotool search --name "Terminal" 2>/dev/null`);
        const ids = stdout.split("\n").filter(Boolean);
        if (ids.length > 0) {
          windowId = ids[ids.length - 1];
          terminalWindows.set(chatId, windowId);
        }
      } catch { /* ignore */ }
    }

    if (!windowId) {
      return JSON.stringify({
        error: "No terminal window found. Use open_terminal_gui first to open one.",
      });
    }

    try {
      // Focus the terminal window
      await run(`xdotool windowfocus --sync ${windowId}`);
      await sleep(200);

      // Type the text using xdotool
      // Use --clearmodifiers to avoid issues with held modifier keys
      await run(`xdotool type --clearmodifiers --delay 30 -- "${text.replace(/"/g, '\\"')}"`);

      if (pressEnter) {
        await sleep(100);
        await run(`xdotool key --clearmodifiers Return`);
      }

      return JSON.stringify({
        success: true,
        typed: text,
        executed: pressEnter,
        message: pressEnter
          ? `Typed and executed "${text}" in the terminal`
          : `Typed "${text}" in the terminal (Enter not pressed)`,
      });
    } catch (error) {
      // Window might have been closed — clear tracking
      terminalWindows.delete(chatId);
      return JSON.stringify({
        error: `Failed to type in terminal: ${error instanceof Error ? error.message : String(error)}`,
        hint: "The terminal window may have been closed. Try open_terminal_gui again.",
      });
    }
  },
});

// ── send_keys_to_terminal ──────────────────────────────────────

registerTool({
  name: "send_keys_to_terminal",
  description:
    "Send special key presses to the visible GUI terminal. " +
    "Use for Ctrl+C (cancel), Ctrl+D (EOF), Ctrl+Z (suspend), " +
    "arrow keys, Tab (autocomplete), etc.",
  parameters: {
    type: "object",
    properties: {
      keys: {
        type: "string",
        description:
          "Key combination in xdotool format. Examples: " +
          "'ctrl+c' (cancel), 'ctrl+d' (EOF), 'ctrl+z' (suspend), " +
          "'ctrl+l' (clear), 'Tab' (autocomplete), 'Up' (previous command), " +
          "'ctrl+shift+t' (new tab)",
      },
    },
    required: ["keys"],
  },
  execute: async (input) => {
    const chatId = ((input as Record<string, unknown>).__chatId as number) ?? 0;
    const keys = input.keys as string;
    const windowId = terminalWindows.get(chatId);

    if (!windowId) {
      return JSON.stringify({
        error: "No terminal window found. Use open_terminal_gui first.",
      });
    }

    try {
      await run(`xdotool windowfocus --sync ${windowId}`);
      await sleep(200);
      await run(`xdotool key --clearmodifiers ${keys}`);

      return JSON.stringify({
        success: true,
        keys,
        message: `Sent ${keys} to terminal`,
      });
    } catch (error) {
      terminalWindows.delete(chatId);
      return JSON.stringify({
        error: `Failed to send keys: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
});

// ── open_folder ────────────────────────────────────────────────

registerTool({
  name: "open_folder",
  description:
    "Open a folder in the GUI file manager (Nautilus). " +
    "Use when the user says 'open folder', 'show files', 'open file manager'.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the folder to open (default: home directory)",
      },
    },
    required: ["path"],
  },
  execute: async (input) => {
    const folderPath = resolve(input.path as string);
    try {
      const info = await stat(folderPath);
      if (!info.isDirectory()) {
        return JSON.stringify({ error: `"${folderPath}" is not a directory` });
      }
      await run(`xdg-open "${folderPath}" 2>/dev/null`);
      return JSON.stringify({ success: true, message: `Opened folder: ${folderPath}`, path: folderPath });
    } catch (error) {
      return JSON.stringify({ error: `Failed to open folder: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
});

// ── open_file ──────────────────────────────────────────────────

registerTool({
  name: "open_file",
  description:
    "Open a file with the system's default application, or a URL in the browser. " +
    "Use when the user says 'open this file', 'show me this image', etc.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file or URL to open" },
    },
    required: ["path"],
  },
  execute: async (input) => {
    const target = input.path as string;
    try {
      if (target.startsWith("http://") || target.startsWith("https://")) {
        await run(`xdg-open "${target}" 2>/dev/null`);
        return JSON.stringify({ success: true, message: `Opened in browser: ${target}` });
      }
      const filePath = resolve(target);
      await stat(filePath);
      await run(`xdg-open "${filePath}" 2>/dev/null`);
      return JSON.stringify({ success: true, message: `Opened file: ${filePath}`, path: filePath });
    } catch (error) {
      return JSON.stringify({ error: `Failed to open: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
});

// ── open_app ───────────────────────────────────────────────────

registerTool({
  name: "open_app",
  description:
    "Launch a GUI application by name (e.g. 'firefox', 'code', 'calculator').",
  parameters: {
    type: "object",
    properties: {
      app_name: { type: "string", description: "Name of the application to launch" },
      args: { type: "array", items: { type: "string" }, description: "Optional arguments" },
    },
    required: ["app_name"],
  },
  execute: async (input) => {
    const appName = input.app_name as string;
    const args = (input.args as string[] | undefined) ?? [];
    const argsStr = args.map((a) => `"${a}"`).join(" ");
    try {
      await run(`nohup ${appName} ${argsStr} > /dev/null 2>&1 &`);
      return JSON.stringify({ success: true, message: `Launched ${appName}` });
    } catch (error) {
      return JSON.stringify({ error: `Failed to launch "${appName}": ${error instanceof Error ? error.message : String(error)}` });
    }
  },
});

// ── open_url ───────────────────────────────────────────────────
// Disabled — BrowserOS handles all browser tasks via browseros.ts
/*
registerTool({
  name: "open_url",
  description: "Open a URL in the default web browser.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to open" },
    },
    required: ["url"],
  },
  execute: async (input) => {
    const url = input.url as string;
    try {
      await run(`xdg-open "${url}" 2>/dev/null`);
      return JSON.stringify({ success: true, message: `Opened in browser: ${url}` });
    } catch (error) {
      return JSON.stringify({ error: `Failed to open URL: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
});
*/
