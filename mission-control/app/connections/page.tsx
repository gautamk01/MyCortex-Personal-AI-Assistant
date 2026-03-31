"use client";

import { useCallback } from "react";
import { Plug, Webhook, CheckCircle2, XCircle, Link2 } from "lucide-react";
import {
  fetchIntegrationHealth, fetchWebhooks, fetchMcpServers,
  type IntegrationStatus, type WebhookInfo, type McpServer,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

export default function ConnectionsPage() {
  const { data: healthData, loading } = usePolling<{ integrations: IntegrationStatus[] }>(
    useCallback(() => fetchIntegrationHealth(), []), 15000
  );
  const { data: webhooksData } = usePolling<{ webhooks: WebhookInfo[] }>(
    useCallback(() => fetchWebhooks(), []), 15000
  );
  const { data: mcpData } = usePolling<{ servers: McpServer[] }>(
    useCallback(() => fetchMcpServers(), []), 15000
  );

  const integrations = healthData?.integrations ?? [];
  const webhooks = webhooksData?.webhooks ?? [];
  const mcpServers = mcpData?.servers ?? [];
  const connected = integrations.filter((i) => i.connected).length;

  return (
    <PageShell title="Connections" subtitle="Integration status and webhook endpoints">
      {loading && !healthData ? <LoadingPage /> : (
        <>
          <div className="stats-grid">
            <StatCard icon={Plug} value={`${connected}/${integrations.length}`} label="Connected" color="green" />
            <StatCard icon={Link2} value={mcpServers.length} label="MCP Servers" color="blue" />
            <StatCard icon={Webhook} value={webhooks.length} label="Active Webhooks" color="orange" />
          </div>

          {/* Connection Progress */}
          {integrations.length > 0 && (
            <div className="section-card" style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Integration Coverage</span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  {connected}/{integrations.length} connected
                </span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${(connected / integrations.length) * 100}%`,
                    background: connected === integrations.length
                      ? "linear-gradient(90deg, var(--brand-green), #70e8b8)"
                      : "linear-gradient(90deg, var(--brand-orange), #ffb347)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Integration Cards */}
          <div className="section-card">
            <div className="section-card-header">
              <div className="section-card-title"><Plug size={18} /> Integrations</div>
            </div>
            <div className="card-grid">
              {integrations.map((integration) => (
                <div
                  key={integration.name}
                  className="card"
                  style={{
                    borderColor: integration.connected ? "rgba(46, 204, 143, 0.2)" : "var(--border-subtle)",
                  }}
                >
                  <div className="card-header">
                    <div className="card-title">{integration.name}</div>
                    {integration.connected ? (
                      <CheckCircle2 size={16} style={{ color: "var(--brand-green)" }} />
                    ) : (
                      <XCircle size={16} style={{ color: "var(--brand-red)" }} />
                    )}
                  </div>
                  <div className="card-body">
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      {integration.details}
                    </p>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <span className={`badge ${integration.connected ? "badge-green" : "badge-red"}`}>
                      {integration.connected ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Webhooks */}
          <div className="section-card">
            <div className="section-card-header">
              <div className="section-card-title"><Webhook size={18} /> Active Webhooks</div>
            </div>
            {webhooks.length === 0 ? (
              <EmptyState icon={Webhook} title="No Webhooks" description="No webhook endpoints active. Create one via the agent." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {webhooks.map((wh) => (
                  <div key={wh.id} className="activity-item">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>{wh.name}</div>
                      <div className="code-block" style={{ marginTop: 6, padding: "6px 10px", fontSize: "0.72rem" }}>
                        {wh.url}
                      </div>
                    </div>
                    {wh.hasSecret && <span className="badge badge-green">Secured</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
