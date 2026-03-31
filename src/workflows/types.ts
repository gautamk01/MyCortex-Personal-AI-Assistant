// ── Workflow Types ─────────────────────────────────────────────

export type NodeType = "tool" | "condition" | "delay";

export interface WorkflowNodeData {
  toolName?: string;
  toolParams?: Record<string, unknown>;
  label: string;
  category?: string;
  description?: string;
  /** Condition nodes: check type */
  conditionType?: "includes" | "equals" | "not_empty";
  conditionValue?: string;
  /** Delay nodes */
  delayMs?: number;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: "draft" | "ready" | "running" | "error";
  lastRunAt?: string;
  lastRunStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodeExecutionResult {
  nodeId: string;
  status: "success" | "error" | "skipped";
  result?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: "running" | "success" | "error";
  nodeResults: NodeExecutionResult[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}
