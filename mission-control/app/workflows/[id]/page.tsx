"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useNodesState, useEdgesState, type Node, type Edge } from "@xyflow/react";
import {
  fetchWorkflow,
  updateWorkflow,
  executeWorkflowApi,
  type Workflow,
  type WorkflowNode as WfNode,
  type WorkflowEdge as WfEdge,
} from "@/lib/api";
import WorkflowCanvas from "@/components/workflows/WorkflowCanvas";
import NodePalette from "@/components/workflows/NodePalette";
import NodeConfigPanel from "@/components/workflows/NodeConfigPanel";
import WorkflowToolbar from "@/components/workflows/WorkflowToolbar";
import "../../workflows/workflows.css";
import "@xyflow/react/dist/style.css";

export default function WorkflowEditorPage() {
  const params = useParams();
  const workflowId = params.id as string;

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [name, setName] = useState("Untitled Workflow");
  const [status, setStatus] = useState("draft");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load workflow
  useEffect(() => {
    if (!workflowId) return;
    fetchWorkflow(workflowId)
      .then((wf) => {
        setWorkflow(wf);
        setName(wf.name);
        setStatus(wf.status);

        // Convert workflow nodes/edges to ReactFlow format
        const rfNodes: Node[] = wf.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data as unknown as Record<string, unknown>,
        }));
        const rfEdges: Edge[] = wf.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          animated: true,
        }));

        setNodes(rfNodes);
        setEdges(rfEdges);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load workflow:", err);
        setLoading(false);
      });
  }, [workflowId, setNodes, setEdges]);

  // Mark dirty on node/edge changes
  useEffect(() => {
    if (!loading && workflow) {
      setIsDirty(true);
    }
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save debounce
  useEffect(() => {
    if (!isDirty || loading) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      handleSave();
    }, 2000);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [isDirty, nodes, edges, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    if (!workflowId) return;
    setIsSaving(true);
    try {
      const wfNodes: WfNode[] = nodes.map((n: Node) => ({
        id: n.id,
        type: (n.type || "tool") as "tool" | "condition" | "delay",
        position: n.position,
        data: n.data as unknown as WfNode["data"],
      }));
      const wfEdges: WfEdge[] = edges.map((e: Edge) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }));

      await updateWorkflow(workflowId, {
        name,
        nodes: wfNodes,
        edges: wfEdges,
      });
      setIsDirty(false);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, nodes, edges, name]);

  const handleRun = useCallback(async () => {
    // Save first
    await handleSave();
    setIsRunning(true);
    try {
      const result = await executeWorkflowApi(workflowId);
      setStatus(result.status === "success" ? "ready" : "error");
    } catch (err) {
      console.error("Run failed:", err);
      setStatus("error");
    } finally {
      setIsRunning(false);
    }
  }, [workflowId, handleSave]);

  const handleDrop = useCallback(
    (position: { x: number; y: number }, payload: Record<string, unknown>) => {
      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: payload.type as string,
        position,
        data: payload.data as Record<string, unknown>,
      };
      setNodes((prev: Node[]) => [...prev, newNode]);
    },
    [setNodes]
  );

  const handleNodeUpdate = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds: Node[]) =>
        nds.map((n: Node) => (n.id === nodeId ? { ...n, data: newData } : n))
      );
      // Update selected node if it's the one being edited
      setSelectedNode((prev) =>
        prev?.id === nodeId ? { ...prev, data: newData } : prev
      );
    },
    [setNodes]
  );

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((nds: Node[]) => nds.filter((n: Node) => n.id !== nodeId));
      setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  if (loading) {
    return (
      <div className="wf-editor">
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading workflow...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="wf-editor">
      <NodePalette />

      <div className="wf-canvas-area">
        <WorkflowToolbar
          name={name}
          status={status}
          isSaving={isSaving}
          isRunning={isRunning}
          isDirty={isDirty}
          onNameChange={(n) => {
            setName(n);
            setIsDirty(true);
          }}
          onSave={handleSave}
          onRun={handleRun}
        />

        <WorkflowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setEdges={setEdges}
          onNodeSelect={setSelectedNode}
          onDrop={handleDrop}
        />
      </div>

      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onUpdate={handleNodeUpdate}
          onDelete={handleNodeDelete}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
