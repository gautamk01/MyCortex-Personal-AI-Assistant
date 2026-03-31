"use client";

import { useState, useCallback } from "react";
import { Calendar, Plus, Play, Pause, Trash2, Clock } from "lucide-react";
import {
  fetchScheduledTasks, createScheduledTask, pauseScheduledTask,
  resumeScheduledTask, deleteScheduledTask, type ScheduledTask,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import { cronToHuman, formatFullDate } from "@/lib/utils";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

export default function SchedulerPage() {
  const { data, loading, refresh } = usePolling<{ tasks: ScheduledTask[] }>(
    useCallback(() => fetchScheduledTasks(), []), 5000
  );
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCron, setFormCron] = useState("");
  const [formAction, setFormAction] = useState("");

  const tasks = data?.tasks ?? [];
  const running = tasks.filter((t) => !t.paused).length;

  const handleCreate = async () => {
    try {
      await createScheduledTask({ name: formName, cron: formCron, action: formAction });
      setFormName(""); setFormCron(""); setFormAction("");
      setShowCreate(false);
      refresh();
    } catch (err) {
      console.error("Create failed:", err);
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    try {
      if (task.paused) {
        await resumeScheduledTask(task.id);
      } else {
        await pauseScheduledTask(task.id);
      }
      refresh();
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteScheduledTask(id);
      refresh();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  return (
    <PageShell title="Scheduler" subtitle="Manage cron-scheduled recurring tasks">
      {loading && !data ? <LoadingPage /> : (
        <>
          <div className="stats-grid">
            <StatCard icon={Calendar} value={tasks.length} label="Total Tasks" color="blue" />
            <StatCard icon={Play} value={running} label="Running" color="green" />
            <StatCard icon={Pause} value={tasks.length - running} label="Paused" color="orange" />
          </div>

          <div className="toolbar">
            <div className="toolbar-spacer" />
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> New Task
            </button>
          </div>

          {tasks.length === 0 ? (
            <div className="section-card">
              <EmptyState icon={Calendar} title="No Scheduled Tasks" description="Create a cron task to automate agent actions." />
            </div>
          ) : (
            <div className="card-grid">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="card"
                  style={{ borderColor: task.paused ? "var(--border-subtle)" : "rgba(46, 204, 143, 0.2)" }}
                >
                  <div className="card-header">
                    <div className="card-title">{task.name}</div>
                    <span className={`badge ${task.paused ? "badge-orange" : "badge-green"}`}>
                      {task.paused ? "Paused" : "Running"}
                    </span>
                  </div>
                  <div className="card-body">
                    <div style={{ marginBottom: 8 }}>
                      <div className="code-block" style={{ padding: "6px 10px", fontSize: "0.74rem", marginBottom: 4 }}>
                        {task.cronExpression}
                      </div>
                      <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                        <Clock size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        {cronToHuman(task.cronExpression)}
                      </span>
                    </div>
                    <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{task.action}</p>
                    <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 6 }}>
                      Created {formatFullDate(task.createdAt)}
                    </p>
                  </div>
                  <div className="card-footer">
                    <button className="btn btn-sm btn-secondary" onClick={() => handleToggle(task)}>
                      {task.paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(task.id)}>
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Scheduled Task">
            <div className="form-group">
              <label className="form-label">Task Name</label>
              <input className="form-input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Daily Reminder" />
            </div>
            <div className="form-group">
              <label className="form-label">Cron Expression</label>
              <input className="form-input" value={formCron} onChange={(e) => setFormCron(e.target.value)} placeholder="e.g. 0 9 * * 1-5" />
              {formCron && (
                <p className="form-hint">{cronToHuman(formCron)}</p>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Action</label>
              <textarea className="form-textarea" value={formAction} onChange={(e) => setFormAction(e.target.value)} placeholder="What should the agent do when this fires?" />
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!formName || !formCron || !formAction}>
                <Plus size={14} /> Create
              </button>
            </div>
          </Modal>
        </>
      )}
    </PageShell>
  );
}
