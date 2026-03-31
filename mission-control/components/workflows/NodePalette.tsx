"use client";

import { useState, useEffect, useMemo, useCallback, type DragEvent } from "react";
import { Search, Wrench, GitBranch, Clock } from "lucide-react";
import { fetchAllTools, type ToolDefinition } from "@/lib/api";

function categorize(name: string): string {
  if (name.startsWith("mcp_")) return "MCP";
  if (name.includes("shell") || name.includes("terminal")) return "Shell";
  if (name.includes("file") || name.includes("directory")) return "Files";
  if (name.includes("browser") || name.includes("web_search") || name.includes("browse")) return "Browser";
  if (name.includes("desktop") || name.includes("window")) return "Desktop";
  if (name.includes("remember") || name.includes("recall") || name.includes("forget")) return "Memory";
  if (name.includes("schedule") || name.includes("reminder")) return "Scheduler";
  if (name.includes("daily_plan") || name.includes("plan")) return "Planning";
  if (name.includes("todoist") || name.includes("task") || name.includes("leetcode")) return "Tasks";
  return "Other";
}

interface NodePaletteProps {
  onDragStart?: () => void;
}

export default function NodePalette({ onDragStart }: NodePaletteProps) {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchAllTools()
      .then((res) => setTools(res.tools))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tools.filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [tools, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, ToolDefinition[]> = {};
    for (const tool of filtered) {
      const cat = categorize(tool.name);
      (groups[cat] ??= []).push(tool);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, type: string, data: Record<string, unknown>) => {
      e.dataTransfer.setData(
        "application/workflow-node",
        JSON.stringify({ type, data })
      );
      e.dataTransfer.effectAllowed = "move";
      onDragStart?.();
    },
    [onDragStart]
  );

  return (
    <div className="wf-palette">
      <div className="wf-palette-header">
        <h3>Node Palette</h3>
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-disabled)",
              pointerEvents: "none",
            }}
          />
          <input
            className="wf-palette-search"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30 }}
          />
        </div>
      </div>

      <div className="wf-palette-list">
        {/* Built-in special nodes */}
        <div className="wf-palette-category">
          <div className="wf-palette-category-label">Logic</div>
          <div
            className="wf-palette-item"
            draggable
            onDragStart={(e) =>
              handleDragStart(e, "condition", {
                label: "Condition",
                conditionType: "not_empty",
              })
            }
          >
            <div className="wf-palette-item-icon condition">
              <GitBranch size={14} />
            </div>
            <span className="wf-palette-item-name">Condition</span>
          </div>
          <div
            className="wf-palette-item"
            draggable
            onDragStart={(e) =>
              handleDragStart(e, "delay", {
                label: "Delay",
                delayMs: 1000,
              })
            }
          >
            <div className="wf-palette-item-icon delay">
              <Clock size={14} />
            </div>
            <span className="wf-palette-item-name">Delay</span>
          </div>
        </div>

        {/* Tool nodes grouped by category */}
        {grouped.map(([category, categoryTools]) => (
          <div key={category} className="wf-palette-category">
            <div className="wf-palette-category-label">
              {category} ({categoryTools.length})
            </div>
            {categoryTools.map((tool) => (
              <div
                key={tool.name}
                className="wf-palette-item"
                draggable
                onDragStart={(e) =>
                  handleDragStart(e, "tool", {
                    toolName: tool.name,
                    toolParams: {},
                    label: tool.name.replace(/_/g, " "),
                    category,
                    description: tool.description.substring(0, 100),
                  })
                }
                title={tool.description}
              >
                <div className="wf-palette-item-icon">
                  <Wrench size={14} />
                </div>
                <span className="wf-palette-item-name">
                  {tool.name.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        ))}

        {tools.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-disabled)", fontSize: "0.8rem" }}>
            Loading tools...
          </div>
        )}
      </div>
    </div>
  );
}
