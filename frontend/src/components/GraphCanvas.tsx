import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphResponse } from "../types";
import { BlastRings } from "./BlastRings";
import { ServiceNode, type ServiceNodeData } from "./ServiceNode";

const nodeTypes = { service: ServiceNode };

function layout(graph: GraphResponse, dimmed: Set<string> | null) {
  const incoming = new Map<string, string[]>();
  graph.nodes.forEach((node) => incoming.set(node.id, []));
  graph.edges.forEach((edge) => incoming.get(edge.target)?.push(edge.source));
  const rank = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    const value = parents.length ? Math.max(...parents.map((parent) => walk(parent, seen))) + 1 : 0;
    rank.set(id, value);
    return value;
  };
  graph.nodes.forEach((node) => walk(node.id, new Set()));
  const columns = new Map<number, typeof graph.nodes>();
  graph.nodes.forEach((node) => {
    const column = rank.get(node.id) ?? 0;
    const list = columns.get(column) ?? [];
    list.push(node);
    columns.set(column, list);
  });
  const flowNodes: Node<ServiceNodeData>[] = [];
  [...columns.keys()]
    .sort((a, b) => a - b)
    .forEach((column) => {
      const list = (columns.get(column) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((node, index) => {
        flowNodes.push({
          id: node.id,
          type: "service",
          position: { x: 64 + column * 280, y: 48 + index * 120 },
          data: {
            label: node.name,
            health: node.health_status,
            status: node.status,
            score: node.health_score,
            dimmed: dimmed ? !dimmed.has(node.id) : false,
          },
        });
      });
    });
  const flowEdges: Edge[] = graph.edges.map((edge) => {
    const impacted = edge.status === "IMPACTED";
    const critical = edge.critical_weight >= 0.9;
    const color = impacted ? "#e24b4a" : critical ? "#9aa3b0" : "#3a4250";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: impacted,
      type: "smoothstep",
      style: {
        stroke: color,
        strokeWidth: impacted ? 2 : critical ? 1.6 : 1.1,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color,
      },
    };
  });
  return { flowNodes, flowEdges };
}

function GraphInner({
  graph,
  selectedId,
  focusId,
  failedId,
  dimmed,
  onSelect,
}: {
  graph: GraphResponse;
  selectedId?: string;
  focusId?: string;
  failedId: string | null;
  dimmed: Set<string> | null;
  onSelect: (id: string) => void;
}) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const { flowNodes, flowEdges } = useMemo(() => layout(graph, dimmed), [dimmed, graph]);
  const nodes = useMemo(
    () => flowNodes.map((node) => ({ ...node, selected: node.id === selectedId })),
    [flowNodes, selectedId],
  );
  const topologyKey = useMemo(
    () =>
      `${graph.nodes.map((node) => node.id).join(",")}|${graph.edges.map((edge) => edge.id).join(",")}`,
    [graph.edges, graph.nodes],
  );

  useEffect(() => {
    if (!flowNodes.length || !nodesInitialized) return;
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.24, duration: 280 });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [fitView, flowNodes.length, nodesInitialized, topologyKey]);

  useEffect(() => {
    if (!focusId) return;
    const timer = window.setTimeout(() => {
      void fitView({ nodes: [{ id: focusId }], padding: 0.45, duration: 400 });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [fitView, focusId]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      onSelect(node.id);
    },
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      fitView
      style={{ width: "100%", height: "100%" }}
      onInit={(instance) => {
        void instance.fitView({ padding: 0.24 });
      }}
      nodesConnectable={false}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect("")}
      minZoom={0.25}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#243042" gap={22} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(8, 10, 14, 0.72)"
        nodeColor={(node) => {
          const status = (node.data as ServiceNodeData).status;
          if (status === "FAILED") return "#e24b4a";
          if (status === "DIRECTLY_AFFECTED") return "#e08a3a";
          if (status === "INDIRECTLY_AFFECTED") return "#d4b44a";
          return "#4b5563";
        }}
      />
      <BlastRings failedId={failedId} />
    </ReactFlow>
  );
}

export function GraphCanvas({
  graph,
  selectedId,
  focusId,
  failedId,
  dimmed,
  onSelect,
}: {
  graph: GraphResponse;
  selectedId?: string;
  focusId?: string;
  failedId: string | null;
  dimmed: Set<string> | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="graph-wrap" style={{ width: "100%", height: "100%" }}>
      <ReactFlowProvider>
        <GraphInner
          graph={graph}
          selectedId={selectedId}
          focusId={focusId}
          failedId={failedId}
          dimmed={dimmed}
          onSelect={onSelect}
        />
      </ReactFlowProvider>
    </div>
  );
}
