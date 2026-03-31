"use client";

import { useState, useCallback, useMemo } from "react";
import { Wrench, Search, ChevronDown, ChevronRight } from "lucide-react";
import { fetchAllTools, type ToolDefinition } from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import SearchBar from "@/components/SearchBar";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

function categorize(name: string): string {
  if (name.startsWith("mcp_")) return "MCP";
  if (name.includes("daily_plan") || name.includes("plan")) return "Planning";
  if (name.includes("todoist") || name.includes("task") || name.includes("leetcode")) return "Gamification";
  if (name.includes("remember") || name.includes("recall") || name.includes("forget") || name.includes("entity") || name.includes("relation") || name.includes("note") || name.includes("media")) return "Memory";
  if (name.includes("schedule") || name.includes("pause_task") || name.includes("resume_task") || name.includes("delete_task")) return "Scheduler";
  if (name.includes("webhook")) return "Webhooks";
  if (name.includes("shell") || name.includes("terminal")) return "Shell";
  if (name.includes("file") || name.includes("directory")) return "Files";
  if (name.includes("browser") || name.includes("web_search") || name.includes("browse")) return "Browser";
  if (name.includes("desktop") || name.includes("window")) return "Desktop";
  if (name.includes("reminder")) return "Reminders";
  if (name.includes("skill")) return "Skills";
  if (name.includes("summary") || name.includes("log") || name.includes("stats")) return "Coaching";
  if (name.includes("time")) return "Utilities";
  return "Other";
}

export default function ToolsPage() {
  const { data, loading } = usePolling<{ tools: ToolDefinition[] }>(
    useCallback(() => fetchAllTools(), []), 30000
  );
  const [search, setSearch] = useState("");
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const tools = data?.tools ?? [];

  const filtered = useMemo(() => {
    if (!search) return tools;
    const q = search.toLowerCase();
    return tools.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }, [tools, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, ToolDefinition[]> = {};
    for (const tool of filtered) {
      const cat = categorize(tool.name);
      (groups[cat] ??= []).push(tool);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleTool = (name: string) => {
    setExpandedTools((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <PageShell title="Tools" subtitle="Browse all registered agent tools and their schemas">
      {loading && !data ? <LoadingPage /> : (
        <>
          <div className="stats-grid">
            <StatCard icon={Wrench} value={tools.length} label="Total Tools" color="orange" />
            <StatCard icon={Search} value={filtered.length} label="Showing" color="blue" />
          </div>

          <SearchBar placeholder="Search tools by name or description..." value={search} onChange={setSearch} />

          {filtered.length === 0 ? (
            <div className="section-card">
              <EmptyState icon={Wrench} title="No Tools Found" description="Try a different search term." />
            </div>
          ) : (
            grouped.map(([category, categoryTools]) => (
              <div key={category} className="section-card" style={{ marginBottom: 16 }}>
                <div className="section-card-header">
                  <div className="section-card-title">
                    {category}
                    <span className="badge badge-muted" style={{ marginLeft: 8 }}>{categoryTools.length}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {categoryTools.map((tool) => (
                    <div key={tool.name}>
                      <div
                        className="activity-item"
                        style={{ cursor: "pointer" }}
                        onClick={() => toggleTool(tool.name)}
                      >
                        {expandedTools[tool.name] ? (
                          <ChevronDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        ) : (
                          <ChevronRight size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: "0.84rem", color: "var(--brand-orange)" }}>
                            {tool.name}
                          </span>
                          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>
                            {tool.description.substring(0, 120)}
                            {tool.description.length > 120 ? "..." : ""}
                          </p>
                        </div>
                      </div>
                      {expandedTools[tool.name] && (
                        <div style={{ padding: "8px 14px 14px 36px" }}>
                          <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                            {tool.description}
                          </p>
                          {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                            <div className="code-block">
                              {JSON.stringify(tool.parameters, null, 2)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </PageShell>
  );
}
