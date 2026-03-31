"use client";

import { useState, useCallback } from "react";
import { Blocks, Wrench, Plus, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import {
  fetchMcpServers, fetchMcpConfig, addMcpServer, removeMcpServer,
  type McpServer, type McpConfig,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

export default function McpPage() {
  const { data: serversData, loading, refresh } = usePolling<{ servers: McpServer[] }>(
    useCallback(() => fetchMcpServers(), []), 10000
  );
  const { data: configData } = usePolling<McpConfig>(
    useCallback(() => fetchMcpConfig(), []), 30000
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formArgs, setFormArgs] = useState("");

  const servers = serversData?.servers ?? [];
  const configServers = configData?.mcpServers ?? {};
  const totalTools = servers.reduce((s, m) => s + m.toolCount, 0);

  // Merge config servers (may not be connected) with connected servers
  const allServerNames = new Set([
    ...servers.map((s) => s.name),
    ...Object.keys(configServers),
  ]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleAdd = async () => {
    try {
      const args = formArgs.split(",").map((a) => a.trim()).filter(Boolean);
      await addMcpServer({ name: formName, command: formCommand, args });
      setFormName(""); setFormCommand(""); setFormArgs("");
      setShowAdd(false);
      refresh();
    } catch (err) {
      console.error("Add server failed:", err);
    }
  };

  const handleRemove = async (name: string) => {
    try {
      await removeMcpServer(name);
      refresh();
    } catch (err) {
      console.error("Remove server failed:", err);
    }
  };

  return (
    <PageShell title="MCP Servers" subtitle="Model Context Protocol server management">
      {loading && !serversData ? <LoadingPage /> : (
        <>
          <div className="stats-grid">
            <StatCard icon={Blocks} value={allServerNames.size} label="Configured Servers" color="blue" />
            <StatCard icon={RefreshCw} value={servers.length} label="Connected" color="green" />
            <StatCard icon={Wrench} value={totalTools} label="Total Tools" color="orange" />
          </div>

          <div className="toolbar">
            <div className="toolbar-spacer" />
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add Server
            </button>
          </div>

          {allServerNames.size === 0 ? (
            <div className="section-card">
              <EmptyState icon={Blocks} title="No MCP Servers" description="Add an MCP server to extend your agent's capabilities." />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {Array.from(allServerNames).map((name) => {
                const connected = servers.find((s) => s.name === name);
                const cfg = configServers[name];
                const isExpanded = expanded[name];

                return (
                  <div
                    key={name}
                    className="card"
                    style={{
                      borderColor: connected ? "rgba(46, 204, 143, 0.2)" : "var(--border-subtle)",
                    }}
                  >
                    <div className="card-header">
                      <div className="card-title">
                        <Blocks size={16} style={{ color: connected ? "var(--brand-green)" : "var(--text-muted)" }} />
                        {name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={`badge ${connected ? "badge-green" : "badge-red"}`}>
                          {connected ? `${connected.toolCount} tools` : "Disconnected"}
                        </span>
                        <button className="btn btn-sm btn-danger" onClick={() => handleRemove(name)}>
                          Remove
                        </button>
                      </div>
                    </div>

                    {cfg && (
                      <div className="card-body">
                        <div className="code-block" style={{ fontSize: "0.74rem", padding: "8px 10px" }}>
                          {cfg.command} {cfg.args?.join(" ")}
                        </div>
                      </div>
                    )}

                    {connected && connected.tools.length > 0 && (
                      <div className="card-footer" style={{ flexDirection: "column", alignItems: "stretch" }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleExpand(name)}
                          style={{ justifyContent: "flex-start" }}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {isExpanded ? "Hide" : "Show"} {connected.tools.length} tools
                        </button>
                        {isExpanded && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                            {connected.tools.map((tool) => (
                              <span key={tool} className="badge badge-muted" style={{ fontSize: "0.68rem" }}>
                                {tool}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add MCP Server">
            <div className="form-group">
              <label className="form-label">Server Name</label>
              <input className="form-input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. filesystem" />
            </div>
            <div className="form-group">
              <label className="form-label">Command</label>
              <input className="form-input" value={formCommand} onChange={(e) => setFormCommand(e.target.value)} placeholder="e.g. npx" />
            </div>
            <div className="form-group">
              <label className="form-label">Arguments (comma-separated)</label>
              <input className="form-input" value={formArgs} onChange={(e) => setFormArgs(e.target.value)} placeholder="e.g. -y, @modelcontextprotocol/server-filesystem, /home" />
              <p className="form-hint">Separate each argument with a comma</p>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={!formName || !formCommand}>
                <Plus size={14} /> Add Server
              </button>
            </div>
          </Modal>
        </>
      )}
    </PageShell>
  );
}
