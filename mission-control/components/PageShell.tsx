"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Cloud,
  Monitor,
  WifiOff,
} from "lucide-react";
import {
  detectEnvironment,
  resetEnvironmentCache,
  type DashboardStats,
  type Environment,
  fetchStats,
} from "@/lib/api";
import Sidebar from "./Sidebar";

const envConfig: Record<Environment, { label: string; color: string; icon: typeof Cloud; short: string }> = {
  production: { label: "Connected to Production (Railway)", color: "var(--brand-green)", icon: Cloud, short: "PROD" },
  local: { label: "Connected to Local Bot", color: "var(--brand-blue)", icon: Monitor, short: "LOCAL" },
  offline: { label: "Agent Offline — Not Reachable", color: "var(--brand-red)", icon: WifiOff, short: "OFFLINE" },
};

interface PageShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function PageShell({ title, subtitle, children }: PageShellProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [env, setEnv] = useState<Environment | null>(null);
  const [showBanner, setShowBanner] = useState(true);

  const loadEnv = useCallback(async () => {
    try {
      const detected = await detectEnvironment();
      setEnv(detected.env);
      const s = await fetchStats();
      setStats(s);
    } catch {
      setEnv("offline");
    }
  }, []);

  useEffect(() => {
    loadEnv();
    const interval = setInterval(loadEnv, 15_000);
    return () => clearInterval(interval);
  }, [loadEnv]);

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

        {envInfo && !showBanner && (
          <button
            onClick={() => {
              resetEnvironmentCache();
              setShowBanner(true);
              loadEnv();
            }}
            className="env-pill"
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
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: envInfo.color }} />
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: envInfo.color }}>
              {envInfo.short}
            </span>
          </button>
        )}

        <div className="page-header">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>

        {children}
      </main>
    </div>
  );
}
