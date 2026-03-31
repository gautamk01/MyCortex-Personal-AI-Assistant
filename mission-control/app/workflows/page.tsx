"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Play, Trash2, Edit, Boxes, Clock, Plus } from "lucide-react";
import {
  fetchWorkflows,
  createWorkflow,
  deleteWorkflow,
  executeWorkflowApi,
  type Workflow,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";
import "../workflows/workflows.css";

export default function WorkflowsPage() {
  const router = useRouter();
  const { data, loading, refresh } = usePolling<{ workflows: Workflow[] }>(
    useCallback(() => fetchWorkflows(), []),
    5000
  );
  const [running, setRunning] = useState<string | null>(null);

  const workflows = data?.workflows ?? [];
  const activeCount = workflows.filter((w) => w.status === "ready" || w.status === "running").length;
  const lastRun = workflows.reduce((latest: string, w) => {
    if (w.lastRunAt && w.lastRunAt > latest) return w.lastRunAt;
    return latest;
  }, "");

  const handleCreate = async () => {
    try {
      const res = await createWorkflow();
      router.push(`/workflows/${res.id}`);
    } catch (err) {
      console.error("Failed to create workflow:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this workflow and all its runs?")) return;
    try {
      await deleteWorkflow(id);
      refresh();
    } catch (err) {
      console.error("Failed to delete workflow:", err);
    }
  };

  const handleRun = async (id: string) => {
    setRunning(id);
    try {
      await executeWorkflowApi(id);
      refresh();
    } catch (err) {
      console.error("Failed to run workflow:", err);
    } finally {
      setRunning(null);
    }
  };

  const statusColor: Record<string, string> = {
    draft: "muted",
    ready: "green",
    running: "blue",
    error: "red",
    success: "green",
  };

  return (
    <PageShell title="Workflows" subtitle="Visual automation workflows — wire together tools to create reusable automations">
      {loading && !data ? (
        <LoadingPage />
      ) : (
        <>
          <div className="stats-grid">
            <StatCard icon={GitBranch} value={workflows.length} label="Total Workflows" color="blue" />
            <StatCard icon={Boxes} value={activeCount} label="Active" color="green" />
            <StatCard
              icon={Clock}
              value={lastRun ? new Date(lastRun).toLocaleDateString() : "Never"}
              label="Last Run"
              color="orange"
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <button className="btn btn-primary" onClick={handleCreate}>
              <Plus size={16} />
              New Workflow
            </button>
          </div>

          {workflows.length === 0 ? (
            <div className="section-card">
              <EmptyState
                icon={GitBranch}
                title="No Workflows Yet"
                description="Create your first workflow to start automating tasks by wiring tools together."
              />
            </div>
          ) : (
            <div className="wf-list-grid">
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  className="wf-card"
                  onClick={() => router.push(`/workflows/${wf.id}`)}
                >
                  <div className="wf-card-header">
                    <div className="wf-card-name">
                      <GitBranch size={16} style={{ color: "var(--brand-blue)" }} />
                      {wf.name}
                    </div>
                    <span className={`badge badge-${statusColor[wf.status] || "muted"}`}>
                      {wf.status}
                    </span>
                  </div>

                  {wf.description && (
                    <p className="wf-card-desc">{wf.description}</p>
                  )}

                  <div className="wf-card-meta">
                    <span className="wf-card-meta-item">
                      <Boxes size={12} />
                      {wf.nodes.length} nodes
                    </span>
                    {wf.lastRunAt && (
                      <span className="wf-card-meta-item">
                        <Clock size={12} />
                        Last: {new Date(wf.lastRunAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="wf-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => router.push(`/workflows/${wf.id}`)}
                    >
                      <Edit size={12} />
                      Edit
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleRun(wf.id)}
                      disabled={running === wf.id}
                    >
                      <Play size={12} />
                      {running === wf.id ? "Running..." : "Run"}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(wf.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
