"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";

export default function ToolNode({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const label = (nodeData.label as string) || "Tool";
  const description = (nodeData.description as string) || (nodeData.toolName as string) || "";

  return (
    <div className={`wf-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="wf-node-header">
        <div className="wf-node-icon tool">
          <Wrench size={14} />
        </div>
        <span className="wf-node-label">{label}</span>
      </div>
      {description && (
        <div className="wf-node-body">
          <p className="wf-node-desc">{description}</p>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
