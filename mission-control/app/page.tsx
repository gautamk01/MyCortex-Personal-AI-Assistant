"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Trophy,
  Zap,
  Heart,
  Database,
  Activity,
  Settings2,
  CheckCircle,
  Clock,
  Cloud,
  Monitor,
  WifiOff,
} from "lucide-react";
import {
  fetchStats,
  fetchActivity,
  fetchConfig,
  detectEnvironment,
  resetEnvironmentCache,
  type DashboardStats,
  type ActivityItem,
  type AgentConfig,
  type Environment,
} from "@/lib/api";
import Sidebar from "@/components/Sidebar";

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString + "Z");
    return d.toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString + "Z");
    return d.toLocaleDateString("en-US", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

const envConfig: Record<Environment, { label: string; color: string; icon: typeof Cloud }> = {
  production: { label: "Connected to Production (Railway)", color: "var(--brand-green)", icon: Cloud },
  local: { label: "Connected to Local Bot", color: "var(--brand-blue)", icon: Monitor },
  offline: { label: "Agent Offline — Not Reachable", color: "var(--brand-red)", icon: WifiOff },
};

export default function CommandCenter() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState<Environment | null>(null);
  const [showBanner, setShowBanner] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const detected = await detectEnvironment();
      setEnv(detected.env);

      if (detected.env === "offline") {
        setError("Agent is offline — neither production nor local is reachable");
        return;
      }

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

  // Initial load + poll every 5 seconds
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Auto-hide banner after 6 seconds
  useEffect(() => {
    if (env && showBanner) {
      const timer = setTimeout(() => setShowBanner(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [env, showBanner]);

  const envInfo = env ? envConfig[env] : null;
  const EnvIcon = envInfo?.icon;

  return (
    <div className="app-shell">
      <Sidebar stats={stats} />

      <main className="page-content">
        {/* ── Environment Banner ──────────────────────────── */}
        {envInfo && showBanner && (
          <div
            className="env-banner"
            style={{
              background: `${envInfo.color}15`,
              border: `1px solid ${envInfo.color}30`,
              borderRadius: "var(--radius-md)",
              padding: "10px 16px",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              animation: "fade-in 0.4s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {EnvIcon && <EnvIcon size={16} style={{ color: envInfo.color }} />}
              <span style={{ fontSize: "0.84rem", fontWeight: 600, color: envInfo.color }}>
                {envInfo.label}
              </span>
            </div>
            <button
              onClick={() => setShowBanner(false)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "0.8rem",
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Environment Indicator (always visible, compact) ── */}
        {envInfo && !showBanner && (
          <button
            onClick={() => {
              resetEnvironmentCache();
              setShowBanner(true);
              loadData();
            }}
            style={{
              position: "fixed",
              top: 12,
              right: 16,
              background: `${envInfo.color}15`,
              border: `1px solid ${envInfo.color}25`,
              borderRadius: 20,
              padding: "4px 12px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              zIndex: 50,
            }}
          >
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: envInfo.color,
            }} />
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: envInfo.color }}>
              {env === "production" ? "PROD" : env === "local" ? "LOCAL" : "OFFLINE"}
            </span>
          </button>
        )}

        <div className="page-header">
          <h1>🚀 Command Center</h1>
          <p>Real-time overview of your AI agent</p>
        </div>

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

        {/* ── Stat Cards ────────────────────────────────────── */}
        <div className="stats-grid">
          <div className="stat-card orange">
            <div className="stat-card-icon orange">
              <Trophy size={18} />
            </div>
            <div className="stat-card-value">
              {stats ? `Lv ${stats.level}` : <span className="skeleton" style={{ width: 60, height: 28, display: "inline-block" }} />}
            </div>
            <div className="stat-card-label">Level & EXP</div>
            {stats && (
              <div className="stat-card-badge">+{stats.expToday} today</div>
            )}
          </div>

          <div className="stat-card blue">
            <div className="stat-card-icon blue">
              <Heart size={18} />
            </div>
            <div className="stat-card-value">
              {stats ? stats.heartbeatsToday : <span className="skeleton" style={{ width: 40, height: 28, display: "inline-block" }} />}
            </div>
            <div className="stat-card-label">Heartbeats Today</div>
          </div>

          <div className="stat-card green">
            <div className="stat-card-icon green">
              <Database size={18} />
            </div>
            <div className="stat-card-value">
              {stats ? stats.totalFacts : <span className="skeleton" style={{ width: 40, height: 28, display: "inline-block" }} />}
            </div>
            <div className="stat-card-label">Stored Memories</div>
          </div>

          <div className="stat-card red">
            <div className="stat-card-icon red">
              <Clock size={18} />
            </div>
            <div className="stat-card-value">
              {stats ? stats.uptime : <span className="skeleton" style={{ width: 60, height: 28, display: "inline-block" }} />}
            </div>
            <div className="stat-card-label">Agent Uptime</div>
          </div>
        </div>

        {/* ── Plan Progress ─────────────────────────────────── */}
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
            <div className="xp-bar" style={{ height: 8 }}>
              <div
                className="xp-bar-fill"
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
          {/* ── Live Activity Feed ────────────────────────────── */}
          <div className="section-card">
            <div className="section-card-header">
              <div className="section-card-title">
                <Activity size={18} />
                Live Activity
              </div>
              <div className="section-card-subtitle">
                Auto-refreshes every 5s
              </div>
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
                          <span className="activity-tag heartbeat">
                            {item.theme}
                          </span>
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

          {/* ── Agent Config ──────────────────────────────────── */}
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
      </main>
    </div>
  );
}
