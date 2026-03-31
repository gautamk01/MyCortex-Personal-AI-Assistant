"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export default function ConditionNode({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const label = (nodeData.label as string) || "Condition";
  const conditionType = (nodeData.conditionType as string) || "not_empty";

  return (
    <div className={`wf-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="wf-node-header">
        <div className="wf-node-icon condition">
          <GitBranch size={14} />
        </div>
        <span className="wf-node-label">{label}</span>
      </div>
      <div className="wf-node-body">
        <p className="wf-node-desc">Check: {conditionType}</p>
      </div>
      <div className="wf-condition-handles">
        <span className="wf-condition-true">✓ True</span>
        <span className="wf-condition-false">✕ False</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: "30%" }} />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: "70%" }} />
    </div>
  );
}
