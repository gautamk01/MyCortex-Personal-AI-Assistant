"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";

export default function DelayNode({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const label = (nodeData.label as string) || "Delay";
  const delayMs = (nodeData.delayMs as number) || 1000;

  const display =
    delayMs >= 60000
      ? `${(delayMs / 60000).toFixed(1)}m`
      : delayMs >= 1000
        ? `${(delayMs / 1000).toFixed(1)}s`
        : `${delayMs}ms`;

  return (
    <div className={`wf-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="wf-node-header">
        <div className="wf-node-icon delay">
          <Clock size={14} />
        </div>
        <span className="wf-node-label">{label}</span>
      </div>
      <div className="wf-node-body">
        <p className="wf-node-desc">Wait {display}</p>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
