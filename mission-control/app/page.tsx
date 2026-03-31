"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Trophy,
  Heart,
  Database,
  Activity,
  Settings2,
  CheckCircle,
  Clock,
  Zap,
} from "lucide-react";
import {
  fetchStats,
  fetchActivity,
  fetchConfig,
  type DashboardStats,
  type ActivityItem,
  type AgentConfig,
} from "@/lib/api";
import { formatTime, formatDate } from "@/lib/utils";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";

export default function CommandCenter() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [s, a, c] = await Promise.all([
        fetchStats(),
        fetchActivity(30),
        fetchConfig(),
      ]);
      setStats(s);
      setActivity(a.activity);
      setAgentConfig(c);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to agent");
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <PageShell title="🚀 Command Center" subtitle="Real-time overview of your AI agent">
      {error && (
        <div className="section-card" style={{ borderColor: "var(--brand-red)" }}>
          <p style={{ color: "var(--brand-red)", fontSize: "0.88rem" }}>
            ⚠️ {error}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: 4 }}>
            Make sure the bot is running and DASHBOARD_SECRET is set.
          </p>
        </div>
      )}

      {/* ── Stat Cards ────────────────────────────────────────── */}
      <div className="stats-grid">
        <StatCard
          icon={Trophy}
          value={stats ? `Lv ${stats.level}` : null}
          label="Level & EXP"
          color="orange"
          badge={stats ? `+${stats.expToday} today` : undefined}
        />
        <StatCard
          icon={Heart}
          value={stats ? stats.heartbeatsToday : null}
          label="Heartbeats Today"
          color="blue"
        />
        <StatCard
          icon={Database}
          value={stats ? stats.totalFacts : null}
          label="Stored Memories"
          color="green"
        />
        <StatCard
          icon={Clock}
          value={stats ? stats.uptime : null}
          label="Agent Uptime"
          color="red"
        />
      </div>

      {/* ── Plan Progress ─────────────────────────────────────── */}
      {stats && stats.plan.total > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <div className="section-card-title">
              <CheckCircle size={18} />
              Today&apos;s Plan Progress
            </div>
            <div className="section-card-subtitle">
              {stats.plan.done}/{stats.plan.total} done · Must-dos: {stats.plan.mustDone}/{stats.plan.mustTotal}
            </div>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{
                width: `${stats.plan.total > 0 ? (stats.plan.done / stats.plan.total) * 100 : 0}%`,
                background: stats.plan.mustDone === stats.plan.mustTotal
                  ? "linear-gradient(90deg, var(--brand-green), #70e8b8)"
                  : "linear-gradient(90deg, var(--brand-orange), #ffb347)",
              }}
            />
          </div>
        </div>
      )}

      <div className="two-col">
        {/* ── Live Activity Feed ──────────────────────────────── */}
        <div className="section-card">
          <div className="section-card-header">
            <div className="section-card-title">
              <Activity size={18} />
              Live Activity
            </div>
            <div className="section-card-subtitle">Auto-refreshes every 5s</div>
          </div>
          <div className="activity-list">
            {activity.length === 0 && !error && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.84rem" }}>
                No recent activity
              </p>
            )}
            {activity.map((item) => (
              <div key={item.id} className="activity-item">
                {item.type === "heartbeat" ? (
                  <>
                    <div className="activity-dot heartbeat" />
                    <div className="activity-body">
                      <div className="activity-body-header">
                        <span className="activity-tag heartbeat">{item.theme}</span>
                        <span className="activity-time">
                          {formatDate(item.createdAt)} {formatTime(item.createdAt)}
                        </span>
                      </div>
                      <p className="activity-message">{item.message}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`activity-dot exp${item.amount < 0 ? " negative" : ""}`} />
                    <div className="activity-body">
                      <div className="activity-body-header">
                        <span className={`activity-tag ${item.amount >= 0 ? "exp" : "exp-negative"}`}>
                          {item.amount >= 0 ? `+${item.amount}` : item.amount} EXP
                        </span>
                        <span className="activity-time">
                          {formatDate(item.createdAt)} {formatTime(item.createdAt)}
                        </span>
                      </div>
                      <p className="activity-message">{item.reason}</p>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Agent Config ────────────────────────────────────── */}
        <div className="section-card">
          <div className="section-card-header">
            <div className="section-card-title">
              <Settings2 size={18} />
              Agent Configuration
            </div>
          </div>

          {agentConfig ? (
            <>
              <div className="config-grid" style={{ marginBottom: 18 }}>
                <div className="config-item">
                  <div className="config-item-label">Model</div>
                  <div className="config-item-value">{agentConfig.agent.model}</div>
                </div>
                <div className="config-item">
                  <div className="config-item-label">Version</div>
                  <div className="config-item-value">v{agentConfig.agent.version}</div>
                </div>
                <div className="config-item">
                  <div className="config-item-label">Max Iterations</div>
                  <div className="config-item-value">{agentConfig.agent.maxIterations}</div>
                </div>
                <div className="config-item">
                  <div className="config-item-label">Tone Mode</div>
                  <div className="config-item-value">{agentConfig.coach.toneMode}</div>
                </div>
                <div className="config-item">
                  <div className="config-item-label">Drift Score</div>
                  <div className="config-item-value">{agentConfig.coach.driftScore.toFixed(2)}</div>
                </div>
                <div className="config-item">
                  <div className="config-item-label">Active Hours</div>
                  <div className="config-item-value">{agentConfig.coach.activeHours}</div>
                </div>
              </div>

              <div className="section-card-title" style={{ marginBottom: 12, fontSize: "0.88rem" }}>
                <Zap size={16} />
                Integrations
              </div>
              <div>
                {Object.entries(agentConfig.integrations).map(([name, active]) => (
                  <div key={name} className="integration-row">
                    <div className={`integration-status ${active ? "active" : "inactive"}`} />
                    <span className="integration-name">
                      {name.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="skeleton" style={{ width: "100%", height: 160 }} />
          )}
        </div>
      </div>
    </PageShell>
  );
}
