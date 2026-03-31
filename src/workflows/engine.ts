import { getDb } from "../memory/sqlite.js";
import { executeTool } from "../tools/index.js";
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  NodeExecutionResult,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────

function generateId(prefix: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix;
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function nowISO(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Resolve template variables like {{nodeId.result}} in param values.
 */
function resolveTemplates(
  value: unknown,
  results: Map<string, NodeExecutionResult>
): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\.result\}\}/g, (_match, nodeId: string) => {
      const res = results.get(nodeId);
      return res?.result ?? "";
    });
  }
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      return value.map((v) => resolveTemplates(v, results));
    }
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveTemplates(v, results);
    }
    return resolved;
  }
  return value;
}

/**
 * Topological sort nodes based on edges (Kahn's algorithm).
 * Returns node IDs in execution order.
 */
function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, deg] of inDegree) {
    if (deg === 0) queue.push(nodeId);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/**
 * Evaluate a condition node against the previous node's output.
 */
function evaluateCondition(
  conditionType: string | undefined,
  conditionValue: string | undefined,
  previousOutput: string
): boolean {
  switch (conditionType) {
    case "includes":
      return previousOutput.includes(conditionValue ?? "");
    case "equals":
      return previousOutput === (conditionValue ?? "");
    case "not_empty":
      return previousOutput.trim().length > 0;
    default:
      return true;
  }
}

// ── Main Execution ────────────────────────────────────────────

export async function executeWorkflow(workflowId: string): Promise<WorkflowRun> {
  const db = getDb();

  // 1. Load workflow
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId) as
    | Record<string, unknown>
    | undefined;

  if (!row) throw new Error(`Workflow not found: ${workflowId}`);

  const nodes: WorkflowNode[] = JSON.parse(row.nodes as string);
  const edges: WorkflowEdge[] = JSON.parse(row.edges as string);

  // 2. Create run record
  const runId = generateId("run_");
  const startedAt = nowISO();

  db.prepare(
    "INSERT INTO workflow_runs (id, workflowId, status, startedAt) VALUES (?, ?, 'running', ?)"
  ).run(runId, workflowId, startedAt);

  // Update workflow status
  db.prepare("UPDATE workflows SET status = 'running', updatedAt = ? WHERE id = ?").run(
    nowISO(),
    workflowId
  );

  const nodeResults = new Map<string, NodeExecutionResult>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 3. Topological sort
  const sortedIds = topologicalSort(nodes, edges);

  // Build downstream map for skipping on failure
  const downstream = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!downstream.has(edge.source)) downstream.set(edge.source, new Set());
    downstream.get(edge.source)!.add(edge.target);
  }

  // Find all downstream nodes recursively
  function getAllDownstream(nodeId: string, visited = new Set<string>()): Set<string> {
    const result = new Set<string>();
    for (const child of downstream.get(nodeId) ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        result.add(child);
        for (const grandchild of getAllDownstream(child, visited)) {
          result.add(grandchild);
        }
      }
    }
    return result;
  }

  const skippedNodes = new Set<string>();
  let runError: string | undefined;

  // 4. Execute in order
  for (const nodeId of sortedIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Skip if marked
    if (skippedNodes.has(nodeId)) {
      nodeResults.set(nodeId, {
        nodeId,
        status: "skipped",
        startedAt: nowISO(),
        completedAt: nowISO(),
      });
      continue;
    }

    const nodeStart = nowISO();

    try {
      let result = "";

      switch (node.type) {
        case "tool": {
          const resolvedParams = resolveTemplates(
            node.data.toolParams ?? {},
            nodeResults
          ) as Record<string, unknown>;
          result = await executeTool(node.data.toolName ?? "", resolvedParams);
          break;
        }

        case "condition": {
          // Find the incoming edge to get previous node's output
          const incomingEdge = edges.find((e) => e.target === nodeId);
          const prevResult = incomingEdge
            ? nodeResults.get(incomingEdge.source)?.result ?? ""
            : "";

          const passed = evaluateCondition(
            node.data.conditionType,
            node.data.conditionValue,
            prevResult
          );
          result = passed ? "true" : "false";

          // If condition failed, skip the "true" branch (source handle = "true")
          // and allow the "false" branch (source handle = "false")
          if (!passed) {
            const trueBranchEdges = edges.filter(
              (e) => e.source === nodeId && e.sourceHandle === "true"
            );
            for (const edge of trueBranchEdges) {
              for (const downId of getAllDownstream(edge.target)) {
                skippedNodes.add(downId);
              }
              skippedNodes.add(edge.target);
            }
          } else {
            const falseBranchEdges = edges.filter(
              (e) => e.source === nodeId && e.sourceHandle === "false"
            );
            for (const edge of falseBranchEdges) {
              for (const downId of getAllDownstream(edge.target)) {
                skippedNodes.add(downId);
              }
              skippedNodes.add(edge.target);
            }
          }
          break;
        }

        case "delay": {
          const delayMs = node.data.delayMs ?? 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          result = `Delayed ${delayMs}ms`;
          break;
        }
      }

      nodeResults.set(nodeId, {
        nodeId,
        status: "success",
        result,
        startedAt: nodeStart,
        completedAt: nowISO(),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      nodeResults.set(nodeId, {
        nodeId,
        status: "error",
        error: errorMsg,
        startedAt: nodeStart,
        completedAt: nowISO(),
      });

      // Mark all downstream as skipped
      for (const downId of getAllDownstream(nodeId)) {
        skippedNodes.add(downId);
      }

      runError = `Node "${node.data.label || nodeId}" failed: ${errorMsg}`;
      break; // Stop execution
    }
  }

  // 5. Build final run
  const allResults = Array.from(nodeResults.values());
  const finalStatus = runError ? "error" : "success";
  const completedAt = nowISO();

  // Update run record
  db.prepare(
    `UPDATE workflow_runs
     SET status = ?, nodeResults = ?, error = ?, completedAt = ?
     WHERE id = ?`
  ).run(finalStatus, JSON.stringify(allResults), runError ?? null, completedAt, runId);

  // Update workflow
  db.prepare(
    `UPDATE workflows SET lastRunAt = ?, lastRunStatus = ?, status = ?, updatedAt = ? WHERE id = ?`
  ).run(completedAt, finalStatus, finalStatus === "error" ? "error" : "ready", nowISO(), workflowId);

  return {
    id: runId,
    workflowId,
    status: finalStatus,
    nodeResults: allResults,
    error: runError,
    startedAt,
    completedAt,
  };
}
