import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  value: string | number | null;
  label: string;
  color: "orange" | "blue" | "green" | "red";
  badge?: string;
}

export default function StatCard({ icon: Icon, value, label, color, badge }: StatCardProps) {
  return (
    <div className={`stat-card ${color}`}>
      <div className={`stat-card-icon ${color}`}>
        <Icon size={18} />
      </div>
      <div className="stat-card-value">
        {value !== null ? (
          value
        ) : (
          <span className="skeleton" style={{ width: 50, height: 28, display: "inline-block" }} />
        )}
      </div>
      <div className="stat-card-label">{label}</div>
      {badge && <div className="stat-card-badge">{badge}</div>}
    </div>
  );
}
