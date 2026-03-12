import { readFile, writeFile, readdir, stat, unlink, mkdir } from "node:fs/promises";
import { join, resolve, relative, extname } from "node:path";
import { registerTool } from "./index.js";
import { config } from "../config.js";

// ── Helpers ────────────────────────────────────────────────────

function isPathAllowed(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  return config.fileAllowedPaths.some(
    (dir) => resolved === dir || resolved.startsWith(dir + "/")
  );
}

function pathGuard(targetPath: string): string | null {
  if (!isPathAllowed(targetPath)) {
    return `Path "${targetPath}" is outside allowed directories: ${config.fileAllowedPaths.join(", ")}`;
  }
  return null;
}

// ── read_file ──────────────────────────────────────────────────

registerTool({
  name: "read_file",
  description:
    "Read the contents of a file. Returns the text content for text files. " +
    "File must be within allowed directories.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file" },
      max_lines: {
        type: "number",
        description: "Maximum number of lines to return (default: all)",
      },
    },
    required: ["path"],
  },
  execute: async (input) => {
    const filePath = resolve(input.path as string);
    const err = pathGuard(filePath);
    if (err) return JSON.stringify({ error: err });

    try {
      const info = await stat(filePath);
      if (info.size > config.fileMaxSizeBytes) {
        return JSON.stringify({
          error: `File is ${info.size} bytes, exceeds limit of ${config.fileMaxSizeBytes} bytes`,
        });
      }

      let content = await readFile(filePath, "utf-8");
      const maxLines = input.max_lines as number | undefined;
      if (maxLines && maxLines > 0) {
        const lines = content.split("\n");
        content = lines.slice(0, maxLines).join("\n");
        if (lines.length > maxLines) {
          content += `\n... (${lines.length - maxLines} more lines)`;
        }
      }

      return JSON.stringify({ path: filePath, content, size: info.size });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── write_file ─────────────────────────────────────────────────

registerTool({
  name: "write_file",
  description:
    "Write content to a file. Creates parent directories if needed. " +
    "File must be within allowed directories.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Content to write to the file" },
      append: {
        type: "boolean",
        description: "If true, append to the file instead of overwriting (default: false)",
      },
    },
    required: ["path", "content"],
  },
  execute: async (input) => {
    const filePath = resolve(input.path as string);
    const content = input.content as string;
    const append = (input.append as boolean) ?? false;
    const err = pathGuard(filePath);
    if (err) return JSON.stringify({ error: err });

    if (Buffer.byteLength(content) > config.fileMaxSizeBytes) {
      return JSON.stringify({
        error: `Content size exceeds limit of ${config.fileMaxSizeBytes} bytes`,
      });
    }

    try {
      // Ensure parent directory exists
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      await mkdir(dir, { recursive: true });

      if (append) {
        const existing = await readFile(filePath, "utf-8").catch(() => "");
        await writeFile(filePath, existing + content, "utf-8");
      } else {
        await writeFile(filePath, content, "utf-8");
      }

      return JSON.stringify({ success: true, path: filePath, bytes: Buffer.byteLength(content) });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── list_directory ─────────────────────────────────────────────

registerTool({
  name: "list_directory",
  description:
    "List files and subdirectories in a directory. " +
    "Directory must be within allowed paths.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the directory to list" },
      recursive: {
        type: "boolean",
        description: "If true, list files recursively (default: false)",
      },
    },
    required: ["path"],
  },
  execute: async (input) => {
    const dirPath = resolve(input.path as string);
    const recursive = (input.recursive as boolean) ?? false;
    const err = pathGuard(dirPath);
    if (err) return JSON.stringify({ error: err });

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const results: Array<{ name: string; type: string; size?: number }> = [];

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const info = await stat(fullPath).catch(() => null);
        results.push({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          size: info && !entry.isDirectory() ? info.size : undefined,
        });

        if (recursive && entry.isDirectory()) {
          try {
            const subEntries = await readdir(fullPath, { withFileTypes: true });
            for (const sub of subEntries) {
              const subPath = join(fullPath, sub.name);
              const subInfo = await stat(subPath).catch(() => null);
              results.push({
                name: join(entry.name, sub.name),
                type: sub.isDirectory() ? "directory" : "file",
                size: subInfo && !sub.isDirectory() ? subInfo.size : undefined,
              });
            }
          } catch { /* skip unreadable subdirs */ }
        }
      }

      return JSON.stringify({ path: dirPath, entries: results, count: results.length });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── search_files ───────────────────────────────────────────────

registerTool({
  name: "search_files",
  description:
    "Search for files matching a pattern (by name or extension) within a directory. " +
    "Directory must be within allowed paths.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to search in" },
      pattern: {
        type: "string",
        description: "Substring to match in file names (e.g. '.ts', 'config')",
      },
    },
    required: ["path", "pattern"],
  },
  execute: async (input) => {
    const dirPath = resolve(input.path as string);
    const pattern = (input.pattern as string).toLowerCase();
    const err = pathGuard(dirPath);
    if (err) return JSON.stringify({ error: err });

    const matches: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > 5 || matches.length >= 50) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue; // skip hidden
          const full = join(dir, entry.name);
          if (entry.name.toLowerCase().includes(pattern)) {
            matches.push(relative(dirPath, full));
          }
          if (entry.isDirectory() && entry.name !== "node_modules") {
            await walk(full, depth + 1);
          }
        }
      } catch { /* skip unreadable */ }
    }

    await walk(dirPath, 0);
    return JSON.stringify({ directory: dirPath, pattern, matches, count: matches.length });
  },
});

// ── delete_file ────────────────────────────────────────────────

registerTool({
  name: "delete_file",
  description:
    "Delete a file. File must be within allowed directories. " +
    "Cannot delete directories (only files).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to delete" },
    },
    required: ["path"],
  },
  execute: async (input) => {
    const filePath = resolve(input.path as string);
    const err = pathGuard(filePath);
    if (err) return JSON.stringify({ error: err });

    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        return JSON.stringify({ error: "Cannot delete directories. Use this tool only for files." });
      }
      await unlink(filePath);
      return JSON.stringify({ success: true, deleted: filePath });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── file_info ──────────────────────────────────────────────────

registerTool({
  name: "file_info",
  description:
    "Get metadata about a file or directory (size, modified date, type). " +
    "Path must be within allowed directories.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file or directory" },
    },
    required: ["path"],
  },
  execute: async (input) => {
    const filePath = resolve(input.path as string);
    const err = pathGuard(filePath);
    if (err) return JSON.stringify({ error: err });

    try {
      const info = await stat(filePath);
      return JSON.stringify({
        path: filePath,
        type: info.isDirectory() ? "directory" : "file",
        size: info.size,
        modified: info.mtime.toISOString(),
        created: info.birthtime.toISOString(),
        extension: info.isFile() ? extname(filePath) : undefined,
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
