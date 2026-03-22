"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Rocket,
  Brain,
  Zap,
  CheckSquare,
  Plug,
  Settings,
  BarChart3,
} from "lucide-react";
import type { DashboardStats } from "@/lib/api";

interface SidebarProps {
  stats?: DashboardStats | null;
}

const navItems = [
  { href: "/", label: "Command Center", icon: Rocket },
  { href: "/brain", label: "Second Brain", icon: Brain },
  { href: "/productivity", label: "Productivity", icon: Zap },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/content", label: "Content Intel", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function getLevelTitle(level: number): string {
  if (level >= 20) return "Commander";
  if (level >= 15) return "Strategist";
  if (level >= 10) return "Operator";
  if (level >= 7) return "Field Agent";
  if (level >= 5) return "Specialist";
  if (level >= 3) return "Recruit";
  return "Cadet";
}

export default function Sidebar({ stats }: SidebarProps) {
  const pathname = usePathname();

  const level = stats?.level ?? 1;
  const totalExp = stats?.totalExp ?? 0;
  const expInLevel = totalExp % 100;
  const expForNextLevel = 100;
  const progressPercent = (expInLevel / expForNextLevel) * 100;

  return (
    <aside className="sidebar">
      {/* ── Brand ───────────────────────────────────────────── */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">🧠</div>
        <div className="sidebar-brand-text">
          <h2>MyCortex</h2>
          <span>Mission Control v0.1</span>
        </div>
      </div>

      {/* ── Agent Status ────────────────────────────────────── */}
      <div className="agent-status">
        <div className="agent-status-row">
          <div className="status-dot" />
          <div className="agent-status-text">
            <strong>Agent Online</strong>
            <br />
            {stats ? `Uptime ${stats.uptime}` : "Connecting…"}
          </div>
        </div>
      </div>

      {/* ── Navigation ──────────────────────────────────────── */}
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive ? " active" : ""}`}
            >
              <item.icon className="nav-icon" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* ── XP Bar ──────────────────────────────────────────── */}
      <div className="sidebar-xp">
        <div className="xp-label">
          <span className="xp-level">Level {level}</span>
          <span className="xp-value">
            {expInLevel} / {expForNextLevel} EXP
          </span>
        </div>
        <div className="xp-bar">
          <div
            className="xp-bar-fill"
            style={{ width: `${Math.min(progressPercent, 100)}%` }}
          />
        </div>
        <div className="xp-title">{getLevelTitle(level)}</div>
      </div>
    </aside>
  );
}
