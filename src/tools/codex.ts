import { execFile } from "node:child_process";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTool } from "./index.js";

// ── Codex CLI Bridge ───────────────────────────────────────────
// Routes prompts to the locally installed `codex exec` CLI and
// returns its final response.

const CODEX_BIN = "/home/gautam/.nvm/versions/node/v22.17.0/bin/codex";

// Per-chat working directory for Codex (defaults to home)
const codexWorkingDirs = new Map<number, string>();

function runCodex(
  prompt: string,
  outputFile: string,
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--skip-git-repo-check",     // allow running outside git repos
      "--ephemeral",               // don't persist sessions
      "--sandbox", "read-only",    // safe default sandbox
      "--output-last-message", outputFile,
      "--",                        // end of flags
      prompt,
    ];

    execFile(CODEX_BIN, args, {
      cwd,
      timeout: 120_000, // 2 minute max
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: {
        ...process.env,
        // Ensure the terminal doesn't try to be interactive
        TERM: "dumb",
      },
    }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(error);
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

// ── codex_ask tool ─────────────────────────────────────────────

registerTool({
  name: "codex_ask",
  description:
    "Ask OpenAI's Codex CLI a question or give it a coding task. " +
    "Routes the prompt through the locally installed `codex` command and returns the response. " +
    "Use this for complex coding tasks, code review, refactoring, explanations, or when the user " +
    "says 'ask codex', 'use codex', 'codex this', etc. " +
    "Codex can also read and modify files in the working directory.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The prompt or task to send to Codex",
      },
      cwd: {
        type: "string",
        description: "Working directory for Codex (optional, defaults to current dir)",
      },
      sandbox: {
        type: "string",
        enum: ["read-only", "workspace-write", "danger-full-access"],
        description: "Sandbox mode: 'read-only' (safe, default), 'workspace-write' (can edit files), 'danger-full-access' (unrestricted)",
      },
    },
    required: ["prompt"],
  },
  execute: async (input) => {
    const chatId = ((input as Record<string, unknown>).__chatId as number) ?? 0;
    const prompt = input.prompt as string;
    const cwd = (input.cwd as string) ?? codexWorkingDirs.get(chatId) ?? process.env.HOME ?? "/tmp";
    const sandbox = (input.sandbox as string) ?? "read-only";

    // Temp file for output
    const outputFile = join(tmpdir(), `gclaw-codex-${Date.now()}-${chatId}.txt`);

    try {
      // Build args — override sandbox if specified
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox", sandbox,
        "--output-last-message", outputFile,
        "--",
        prompt,
      ];

      const { stderr } = await new Promise<{ stdout: string; stderr: string }>((res, rej) => {
        execFile(CODEX_BIN, args, {
          cwd,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, TERM: "dumb" },
        }, (error, stdout, stderr) => {
          if (error && !stdout && !stderr) rej(error);
          else res({ stdout: stdout.toString(), stderr: stderr.toString() });
        });
      });

      // Read response from the output file
      let response: string;
      try {
        response = await readFile(outputFile, "utf-8");
      } catch {
        // If output file wasn't written, extract from stderr or indicate failure
        response = stderr || "Codex completed without generating a response.";
      }

      // Clean up temp file
      await unlink(outputFile).catch(() => {});

      return JSON.stringify({
        success: true,
        response: response.trim().slice(0, 8000), // Telegram has limits
        cwd,
        sandbox,
      });
    } catch (error) {
      await unlink(outputFile).catch(() => {});
      return JSON.stringify({
        error: `Codex failed: ${error instanceof Error ? error.message : String(error)}`,
        hint: "Make sure Codex CLI is configured with a valid API key (run `codex login` if needed)",
      });
    }
  },
});

// ── codex_set_dir tool ─────────────────────────────────────────

registerTool({
  name: "codex_set_dir",
  description:
    "Set the working directory that Codex will use for subsequent tasks. " +
    "Use this when the user wants Codex to work on a specific project.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the project directory",
      },
    },
    required: ["path"],
  },
  execute: async (input) => {
    const chatId = ((input as Record<string, unknown>).__chatId as number) ?? 0;
    const path = input.path as string;
    codexWorkingDirs.set(chatId, path);
    return JSON.stringify({
      success: true,
      message: `Codex working directory set to: ${path}`,
    });
  },
});
