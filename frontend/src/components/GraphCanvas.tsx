import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphResponse } from "../types";

function layout(graph: GraphResponse) {
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
  const flowNodes: Node[] = [];
  [...columns.keys()]
    .sort((a, b) => a - b)
    .forEach((column) => {
      const list = (columns.get(column) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((node, index) => {
        flowNodes.push({
          id: node.id,
          position: { x: 40 + column * 240, y: 30 + index * 92 },
          data: { label: node.name, health: node.health_status, status: node.status, score: node.health_score },
          style: {
            border: "1px solid #111",
            borderRadius: 6,
            padding: 10,
            background: node.status === "FAILED" ? "#111" : "#fff",
            color: node.status === "FAILED" ? "#fff" : "#111",
            fontSize: 13,
            width: 180,
          },
        });
      });
    });
  const flowEdges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.status === "IMPACTED",
    style: { stroke: edge.status === "IMPACTED" ? "#111" : "#bbb", strokeWidth: edge.status === "IMPACTED" ? 1.6 : 1 },
    label: `${edge.call_count}`,
  }));
  return { flowNodes, flowEdges };
}

export function GraphCanvas({
  graph,
  onSelect,
}: {
  graph: GraphResponse;
  onSelect: (id: string) => void;
}) {
  const { flowNodes, flowEdges } = useMemo(() => layout(graph), [graph]);
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      onSelect(node.id);
    },
    [onSelect],
  );

  return (
    <div className="graph-wrap">
      <ReactFlow
        key={graph.nodes.map((node) => `${node.id}:${node.status}`).join("|")}
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        onNodeClick={onNodeClick}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#ececec" gap={18} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
