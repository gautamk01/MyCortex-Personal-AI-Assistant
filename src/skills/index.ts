import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { registerTool } from "../tools/index.js";
import { config } from "../config.js";

// ── Types ──────────────────────────────────────────────────────

interface Skill {
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  filePath: string;
}

// ── State ──────────────────────────────────────────────────────

const loadedSkills: Skill[] = [];

// ── Markdown Parser ────────────────────────────────────────────

function parseSkillFile(content: string, filePath: string): Skill | null {
  // Parse frontmatter-style skill definitions
  // Expected format:
  // ---
  // name: Skill Name
  // description: What this skill does
  // triggers: keyword1, keyword2
  // ---
  // Instructions go here...

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // Try simpler format: # Title\n\nDescription\n\n## Instructions\n...
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const name = titleMatch?.[1]?.trim() ?? filePath.split("/").pop()?.replace(".md", "") ?? "unknown";

    return {
      name,
      description: content.split("\n").slice(1, 3).join(" ").trim().slice(0, 200) || name,
      triggers: [name.toLowerCase()],
      instructions: content,
      filePath,
    };
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  const getField = (field: string): string => {
    const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim() ?? "";
  };

  const name = getField("name") || filePath.split("/").pop()?.replace(".md", "") || "unknown";
  const description = getField("description") || name;
  const triggersStr = getField("triggers");
  const triggers = triggersStr
    ? triggersStr.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
    : [name.toLowerCase()];

  return {
    name,
    description,
    triggers,
    instructions: body,
    filePath,
  };
}

// ── Load Skills ────────────────────────────────────────────────

export async function loadSkills(): Promise<void> {
  const skillsDir = resolve(config.skillsDir);

  try {
    const files = await readdir(skillsDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    if (mdFiles.length === 0) {
      console.log(`ℹ️  No skill files found in ${skillsDir}`);
      return;
    }

    for (const file of mdFiles) {
      try {
        const content = await readFile(join(skillsDir, file), "utf-8");
        const skill = parseSkillFile(content, join(skillsDir, file));
        if (skill) {
          loadedSkills.push(skill);
          console.log(`📚 Loaded skill: ${skill.name}`);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to load skill "${file}":`, error);
      }
    }

    console.log(`📚 ${loadedSkills.length} skill(s) loaded from ${skillsDir}`);
  } catch {
    console.log(`ℹ️  Skills directory not found: ${skillsDir} — skills disabled`);
  }
}

// ── Get Skills for System Prompt ───────────────────────────────

export function getSkillsPromptSection(): string {
  if (loadedSkills.length === 0) return "";

  let section = "\n\n## Loaded Skills\nYou have the following skills available:\n\n";

  for (const skill of loadedSkills) {
    section += `### ${skill.name}\n`;
    section += `${skill.description}\n`;
    section += `Triggers: ${skill.triggers.join(", ")}\n\n`;
    section += `${skill.instructions}\n\n`;
  }

  return section;
}

// ── Tools ──────────────────────────────────────────────────────

registerTool({
  name: "list_skills",
  description:
    "List all loaded skills. Skills are markdown files that define additional capabilities.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const skills = loadedSkills.map(({ name, description, triggers, filePath }) => ({
      name,
      description,
      triggers,
      filePath,
    }));
    return JSON.stringify({ skills, count: skills.length });
  },
});

registerTool({
  name: "get_skill_details",
  description:
    "Get the full instructions for a specific skill by name.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the skill to retrieve" },
    },
    required: ["name"],
  },
  execute: async (input) => {
    const skillName = (input.name as string).toLowerCase();
    const skill = loadedSkills.find(
      (s) =>
        s.name.toLowerCase() === skillName ||
        s.triggers.includes(skillName)
    );

    if (!skill) {
      return JSON.stringify({
        error: `Skill "${input.name}" not found. Use list_skills to see available skills.`,
      });
    }

    return JSON.stringify({
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers,
      instructions: skill.instructions,
    });
  },
});
