"use client";

import { X, Trash2 } from "lucide-react";
import type { Node } from "@xyflow/react";

interface NodeConfigPanelProps {
  node: Node;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

export default function NodeConfigPanel({ node, onUpdate, onDelete, onClose }: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;
  const nodeType = node.type as string;

  const updateField = (key: string, value: unknown) => {
    onUpdate(node.id, { ...data, [key]: value });
  };

  const updateParam = (paramKey: string, value: unknown) => {
    const params = (data.toolParams as Record<string, unknown>) || {};
    onUpdate(node.id, { ...data, toolParams: { ...params, [paramKey]: value } });
  };

  return (
    <div className="wf-config-panel">
      <div className="wf-config-header">
        <h3>Configure Node</h3>
        <button className="wf-config-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="wf-config-body">
        {/* Common: Label */}
        <div className="wf-config-field">
          <label>Label</label>
          <input
            type="text"
            value={(data.label as string) || ""}
            onChange={(e) => updateField("label", e.target.value)}
          />
        </div>

        {/* Tool-specific fields */}
        {nodeType === "tool" && (
          <>
            <div className="wf-config-field">
              <label>Tool Name</label>
              <input
                type="text"
                value={(data.toolName as string) || ""}
                onChange={(e) => updateField("toolName", e.target.value)}
                readOnly
                style={{ opacity: 0.7 }}
              />
            </div>

            <div className="wf-config-field">
              <label>Description</label>
              <textarea
                value={(data.description as string) || ""}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="What this step does..."
              />
            </div>

            {/* Dynamic params from toolParams */}
            {Object.entries((data.toolParams as Record<string, unknown>) || {}).map(
              ([key, value]) => (
                <div key={key} className="wf-config-field">
                  <label>{key}</label>
                  {typeof value === "boolean" ? (
                    <input
                      type="checkbox"
                      className="wf-checkbox"
                      checked={value}
                      onChange={(e) => updateParam(key, e.target.checked)}
                    />
                  ) : typeof value === "number" ? (
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => updateParam(key, Number(e.target.value))}
                    />
                  ) : (
                    <input
                      type="text"
                      value={String(value ?? "")}
                      onChange={(e) => updateParam(key, e.target.value)}
                    />
                  )}
                </div>
              )
            )}

            {/* Add parameter button */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const name = prompt("Parameter name:");
                if (name) updateParam(name, "");
              }}
            >
              + Add Parameter
            </button>

            <div className="wf-config-hint">
              💡 Use <code>{"{{nodeId.result}}"}</code> in parameter values to reference
              another node&apos;s output.
            </div>
          </>
        )}

        {/* Condition fields */}
        {nodeType === "condition" && (
          <>
            <div className="wf-config-field">
              <label>Check Type</label>
              <select
                value={(data.conditionType as string) || "not_empty"}
                onChange={(e) => updateField("conditionType", e.target.value)}
              >
                <option value="not_empty">Not Empty</option>
                <option value="includes">Includes</option>
                <option value="equals">Equals</option>
              </select>
            </div>

            {(data.conditionType === "includes" || data.conditionType === "equals") && (
              <div className="wf-config-field">
                <label>Compare Value</label>
                <input
                  type="text"
                  value={(data.conditionValue as string) || ""}
                  onChange={(e) => updateField("conditionValue", e.target.value)}
                  placeholder="Value to compare against..."
                />
              </div>
            )}
          </>
        )}

        {/* Delay fields */}
        {nodeType === "delay" && (
          <div className="wf-config-field">
            <label>Delay (milliseconds)</label>
            <input
              type="number"
              value={(data.delayMs as number) || 1000}
              onChange={(e) => updateField("delayMs", Number(e.target.value))}
              min={100}
              step={100}
            />
          </div>
        )}
      </div>

      <div className="wf-config-footer">
        <button
          className="btn btn-danger btn-sm"
          onClick={() => onDelete(node.id)}
          style={{ width: "100%" }}
        >
          <Trash2 size={14} />
          Delete Node
        </button>
      </div>
    </div>
  );
}
