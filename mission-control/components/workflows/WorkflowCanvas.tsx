"use client";

import { useCallback, type DragEvent } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ToolNode from "./ToolNode";
import ConditionNode from "./ConditionNode";
import DelayNode from "./DelayNode";

const nodeTypes = {
  tool: ToolNode,
  condition: ConditionNode,
  delay: DelayNode,
};

interface WorkflowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onNodeSelect: (node: Node | null) => void;
  onDrop: (position: { x: number; y: number }, data: Record<string, unknown>) => void;
}

export default function WorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setEdges,
  onNodeSelect,
  onDrop,
}: WorkflowCanvasProps) {
  const onConnect: OnConnect = useCallback(
    (connection) => {
      setEdges((eds) => addEdge({ ...connection, id: `e-${Date.now()}` }, eds));
    },
    [setEdges]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();

      const raw = e.dataTransfer.getData("application/workflow-node");
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        // Get position relative to the canvas
        const bounds = e.currentTarget.getBoundingClientRect();
        const position = {
          x: e.clientX - bounds.left,
          y: e.clientY - bounds.top,
        };
        onDrop(position, parsed);
      } catch {
        // Invalid data
      }
    },
    [onDrop]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeSelect(node);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  return (
    <div
      style={{ flex: 1, height: "100%" }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: "var(--brand-blue)", strokeWidth: 2 },
        }}
        style={{ background: "var(--bg-page)" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.05)" />
        <Controls />
        <MiniMap
          nodeColor={() => "var(--brand-blue)"}
          maskColor="rgba(0,0,0,0.7)"
          style={{ background: "var(--bg-card)" }}
        />
      </ReactFlow>
    </div>
  );
}
