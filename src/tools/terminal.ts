import { spawn, type ChildProcess } from "node:child_process";
import { registerTool } from "./index.js";

// ── Interactive Terminal ───────────────────────────────────────
// Maintains a persistent shell session per chat.
// The agent can open a terminal, run commands, read output,
// and the working directory / environment persists between calls.

interface TerminalSession {
  process: ChildProcess;
  chatId: number;
  outputBuffer: string;
  cwd: string;
  createdAt: string;
}

const sessions = new Map<number, TerminalSession>();

// Marker used to detect when a command finishes
const END_MARKER = `__GCLAW_END_${Date.now()}__`;

function getSession(chatId: number): TerminalSession | null {
  return sessions.get(chatId) ?? null;
}

function collectOutput(session: TerminalSession): Promise<string> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        // Return whatever we have
        resolve(output || session.outputBuffer);
        session.outputBuffer = "";
      }
    }, 5000); // 5 second max wait

    const checkInterval = setInterval(() => {
      // Check if the end marker appeared in the buffer
      const markerIndex = session.outputBuffer.indexOf(END_MARKER);
      if (markerIndex !== -1) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        if (!settled) {
          settled = true;
          // Get everything before the marker
          output = session.outputBuffer.substring(0, markerIndex).trim();
          // Clean up - remove everything up to and including the marker line
          const afterMarker = session.outputBuffer.substring(
            markerIndex + END_MARKER.length
          );
          session.outputBuffer = afterMarker;
          resolve(output);
        }
      }
    }, 100);
  });
}

// ── open_terminal ──────────────────────────────────────────────

registerTool({
  name: "open_terminal",
  description:
    "Open a persistent interactive terminal session. The session stays alive " +
    "across multiple commands, maintaining working directory and environment. " +
    "Use this when the user asks to 'open a terminal' or needs an interactive shell. " +
    "Only one terminal per chat is allowed.",
  parameters: {
    type: "object",
    properties: {
      cwd: {
        type: "string",
        description: "Starting directory for the terminal (default: home directory)",
      },
    },
    required: [],
  },
  execute: async (input) => {
    const chatId = (input as Record<string, unknown>).__chatId as number | undefined;
    const id = chatId ?? 0;

    // Close existing session if any
    const existing = sessions.get(id);
    if (existing) {
      existing.process.kill();
      sessions.delete(id);
    }

    const cwd = (input.cwd as string) ?? process.env.HOME ?? "/";

    const proc = spawn("/bin/bash", ["--norc", "--noprofile", "-i"], {
      cwd,
      env: {
        ...process.env,
        TERM: "dumb",
        PS1: "$ ",
        // Disable pagers
        PAGER: "cat",
        GIT_PAGER: "cat",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const session: TerminalSession = {
      process: proc,
      chatId: id,
      outputBuffer: "",
      cwd,
      createdAt: new Date().toISOString(),
    };

    proc.stdout?.on("data", (data: Buffer) => {
      session.outputBuffer += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      session.outputBuffer += data.toString();
    });

    proc.on("exit", (code) => {
      console.log(`🖥️  Terminal for chat ${id} exited with code ${code}`);
      sessions.delete(id);
    });

    sessions.set(id, session);

    // Wait a moment for the shell to start
    await new Promise((r) => setTimeout(r, 500));
    session.outputBuffer = ""; // Clear startup noise

    return JSON.stringify({
      success: true,
      message: `Terminal session opened in ${cwd}`,
      cwd,
      hint: "Use 'terminal_run' to execute commands in this terminal.",
    });
  },
});

// ── terminal_run ───────────────────────────────────────────────

registerTool({
  name: "terminal_run",
  description:
    "Run a command in the current interactive terminal session. " +
    "The terminal remembers the working directory, so 'cd /some/path' will persist " +
    "for subsequent commands. Use open_terminal first if no session exists. " +
    "This is for interactive usage — the state persists between calls.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run (e.g. 'cd /home', 'ls -la', 'git status')",
      },
    },
    required: ["command"],
  },
  execute: async (input) => {
    const chatId = (input as Record<string, unknown>).__chatId as number | undefined;
    const id = chatId ?? 0;
    const session = getSession(id);

    if (!session) {
      return JSON.stringify({
        error: "No terminal session is open. Use open_terminal first.",
      });
    }

    if (!session.process.stdin?.writable) {
      sessions.delete(id);
      return JSON.stringify({
        error: "Terminal session has died. Use open_terminal to start a new one.",
      });
    }

    const command = input.command as string;

    // Clear the output buffer before sending the command
    session.outputBuffer = "";

    // Send the command, followed by an echo of our end marker
    session.process.stdin.write(
      `${command}\necho "${END_MARKER}"\n`
    );

    // Collect output until we see the end marker or timeout
    const output = await collectOutput(session);

    // Update tracked cwd if it was a cd command
    if (command.trim().startsWith("cd ")) {
      // Ask the shell for the actual cwd
      session.outputBuffer = "";
      session.process.stdin.write(`pwd\necho "${END_MARKER}"\n`);
      const pwdOutput = await collectOutput(session);
      const newCwd = pwdOutput.split("\n").find((l) => l.startsWith("/"))?.trim();
      if (newCwd) {
        session.cwd = newCwd;
      }
    }

    // Clean up the output — remove echo of the command and marker commands
    const lines = output.split("\n");
    const cleanedLines = lines.filter(
      (line) =>
        !line.includes(END_MARKER) &&
        !line.trim().startsWith("$ ") // Remove prompt lines
    );
    const cleanOutput = cleanedLines.join("\n").trim();

    return JSON.stringify({
      output: cleanOutput.slice(0, 5000),
      cwd: session.cwd,
    });
  },
});

// ── terminal_status ────────────────────────────────────────────

registerTool({
  name: "terminal_status",
  description:
    "Check the status of the current interactive terminal session — " +
    "whether it's alive, its working directory, and any pending output.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (input) => {
    const chatId = (input as Record<string, unknown>).__chatId as number | undefined;
    const id = chatId ?? 0;
    const session = getSession(id);

    if (!session) {
      return JSON.stringify({
        active: false,
        message: "No terminal session is open. Use open_terminal to start one.",
      });
    }

    return JSON.stringify({
      active: true,
      cwd: session.cwd,
      createdAt: session.createdAt,
      pendingOutput: session.outputBuffer.length > 0,
    });
  },
});

// ── close_terminal ─────────────────────────────────────────────

registerTool({
  name: "close_terminal",
  description: "Close the current interactive terminal session.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (input) => {
    const chatId = (input as Record<string, unknown>).__chatId as number | undefined;
    const id = chatId ?? 0;
    const session = getSession(id);

    if (!session) {
      return JSON.stringify({ message: "No terminal session to close." });
    }

    session.process.kill();
    sessions.delete(id);
    return JSON.stringify({ success: true, message: "Terminal session closed." });
  },
});

// ── Cleanup on shutdown ────────────────────────────────────────

export function closeAllTerminals(): void {
  for (const [id, session] of sessions) {
    session.process.kill();
  }
  sessions.clear();
}
