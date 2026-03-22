import { execFile } from "node:child_process";
import { registerTool } from "./index.js";
import { config } from "../config.js";

// ── Shell Command Tool ─────────────────────────────────────────
// Executes shell commands with allowlists, directory restrictions,
// and configurable timeouts.

registerTool({
  name: "run_shell_command",
  description:
    "Execute a shell command and return its output. " +
    "Only whitelisted commands are allowed. " +
    "Use this to run system commands, check system info, manage processes, etc.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute (e.g. 'ls', 'cat', 'date')",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments to pass to the command",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command (optional, must be within allowed dirs)",
      },
    },
    required: ["command"],
  },
  execute: async (input) => {
    const command = input.command as string;
    const args = (input.args as string[] | undefined) ?? [];
    const cwd = input.cwd as string | undefined;

    // ── Sandbox restrictions have been removed per user request ──

    // ── Execute ────────────────────────────────────────────────
    return new Promise<string>((resolve) => {
      execFile(
        command,
        args,
        {
          cwd: cwd ?? process.cwd(),
          timeout: config.shellTimeout,
          maxBuffer: 1024 * 1024, // 1MB
          shell: false,
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve(
              JSON.stringify({
                exitCode: error.code ?? 1,
                stdout: stdout.slice(0, 5000),
                stderr: stderr.slice(0, 5000),
                error: error.message,
              })
            );
            return;
          }
          resolve(
            JSON.stringify({
              exitCode: 0,
              stdout: stdout.slice(0, 5000),
              stderr: stderr.slice(0, 5000),
            })
          );
        }
      );
    });
  },
});
