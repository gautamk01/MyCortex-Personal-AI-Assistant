"use client";

import { ArrowLeft, Save, Play, Check, Loader } from "lucide-react";
import { useRouter } from "next/navigation";

interface WorkflowToolbarProps {
  name: string;
  status: string;
  isSaving: boolean;
  isRunning: boolean;
  isDirty: boolean;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onRun: () => void;
}

export default function WorkflowToolbar({
  name,
  status,
  isSaving,
  isRunning,
  isDirty,
  onNameChange,
  onSave,
  onRun,
}: WorkflowToolbarProps) {
  const router = useRouter();

  const statusColor: Record<string, string> = {
    draft: "muted",
    ready: "green",
    running: "blue",
    error: "red",
    success: "green",
  };

  return (
    <div className="wf-toolbar">
      <button
        className="wf-toolbar-back"
        onClick={() => router.push("/workflows")}
        title="Back to workflows"
      >
        <ArrowLeft size={18} />
      </button>

      <input
        className="wf-toolbar-name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Workflow name..."
      />

      <span className={`badge badge-${statusColor[status] || "muted"}`}>
        {status}
      </span>

      <div className="wf-toolbar-actions">
        <button
          className="btn btn-secondary btn-sm"
          onClick={onSave}
          disabled={isSaving || !isDirty}
        >
          {isSaving ? (
            <Loader size={14} className="spin" />
          ) : isDirty ? (
            <Save size={14} />
          ) : (
            <Check size={14} />
          )}
          {isDirty ? "Save" : "Saved"}
        </button>

        <button
          className="btn btn-primary btn-sm"
          onClick={onRun}
          disabled={isRunning}
        >
          {isRunning ? (
            <Loader size={14} className="spin" />
          ) : (
            <Play size={14} />
          )}
          {isRunning ? "Running..." : "Run"}
        </button>
      </div>
    </div>
  );
}
