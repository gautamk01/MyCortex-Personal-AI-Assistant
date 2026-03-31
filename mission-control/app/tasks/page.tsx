"use client";

import { useState, useCallback } from "react";
import { CheckSquare, ListChecks, Target, Clock, Circle, CheckCircle2, SkipForward } from "lucide-react";
import { fetchPlan, completePlanItem, updatePlanItem, type PlanItem, type PlanResponse } from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import TabBar from "@/components/TabBar";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

const priorityColors: Record<string, string> = {
  must: "var(--brand-red)",
  should: "var(--brand-orange)",
  could: "var(--brand-blue)",
};

const statusIcons: Record<string, typeof Circle> = {
  pending: Circle,
  "in-progress": Clock,
  done: CheckCircle2,
  skipped: SkipForward,
};

const tabs = [
  { key: "all", label: "All" },
  { key: "must", label: "Must" },
  { key: "should", label: "Should" },
  { key: "could", label: "Could" },
];

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState("all");
  const { data, loading, refresh } = usePolling<PlanResponse>(fetchPlan, 5000);

  const handleComplete = useCallback(async (item: PlanItem) => {
    try {
      await completePlanItem(item.id);
      refresh();
    } catch (err) {
      console.error("Failed to complete item:", err);
    }
  }, [refresh]);

  const handleSkip = useCallback(async (item: PlanItem) => {
    try {
      await updatePlanItem(item.id, { status: "skipped" });
      refresh();
    } catch (err) {
      console.error("Failed to skip item:", err);
    }
  }, [refresh]);

  const items = data?.plan?.items ?? [];
  const filtered = activeTab === "all" ? items : items.filter((i) => i.priority === activeTab);
  const stats = data?.stats;

  return (
    <PageShell title="Tasks" subtitle="Today's daily plan and progress">
      {loading && !data ? (
        <LoadingPage />
      ) : !data?.plan ? (
        <EmptyState
          icon={CheckSquare}
          title="No Plan Today"
          description="No daily plan has been created yet. Ask your agent to create one."
        />
      ) : (
        <>
          <div className="stats-grid">
            <StatCard
              icon={ListChecks}
              value={stats ? `${stats.done}/${stats.total}` : null}
              label="Tasks Done"
              color="green"
            />
            <StatCard
              icon={Target}
              value={stats ? `${stats.mustDone}/${stats.mustTotal}` : null}
              label="Must-Dos"
              color="red"
              badge={stats && stats.mustDone === stats.mustTotal ? "Complete" : undefined}
            />
            <StatCard
              icon={CheckSquare}
              value={items.filter((i) => i.status === "pending").length}
              label="Remaining"
              color="orange"
            />
            <StatCard
              icon={Clock}
              value={data.plan.planDate}
              label="Plan Date"
              color="blue"
            />
          </div>

          {stats && stats.total > 0 && (
            <div className="section-card" style={{ marginBottom: 20 }}>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${(stats.done / stats.total) * 100}%`,
                    background: stats.mustDone === stats.mustTotal
                      ? "linear-gradient(90deg, var(--brand-green), #70e8b8)"
                      : "linear-gradient(90deg, var(--brand-orange), #ffb347)",
                  }}
                />
              </div>
            </div>
          )}

          <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="section-card">
            {filtered.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", padding: 16 }}>
                No items in this category
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map((item) => {
                  const StatusIcon = statusIcons[item.status] ?? Circle;
                  const isDone = item.status === "done" || item.status === "skipped";
                  return (
                    <div
                      key={item.id}
                      className="activity-item"
                      style={{ opacity: isDone ? 0.5 : 1 }}
                    >
                      <StatusIcon
                        size={18}
                        style={{
                          color: item.status === "done"
                            ? "var(--brand-green)"
                            : item.status === "skipped"
                            ? "var(--text-muted)"
                            : priorityColors[item.priority] ?? "var(--text-secondary)",
                          marginTop: 2,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{
                            fontSize: "0.88rem", fontWeight: 500,
                            textDecoration: isDone ? "line-through" : "none",
                            color: isDone ? "var(--text-muted)" : "var(--text-primary)",
                          }}>
                            {item.title}
                          </span>
                          <span className={`badge badge-${item.priority === "must" ? "red" : item.priority === "should" ? "orange" : "blue"}`}>
                            {item.priority}
                          </span>
                          {item.category && (
                            <span className="badge badge-muted">{item.category}</span>
                          )}
                        </div>
                        {item.timeBlock && (
                          <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                            <Clock size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                            {item.timeBlock}
                          </span>
                        )}
                      </div>
                      {!isDone && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleComplete(item)}>
                            Done
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => handleSkip(item)}>
                            Skip
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
