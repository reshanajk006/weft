import { useViewport, useNodes, type Node } from "@xyflow/react";
import type { ServiceNodeData } from "./ServiceNode";

const NODE_W = 200;
const NODE_H = 56;

function center(node: Node<ServiceNodeData>) {
  return { x: node.position.x + NODE_W / 2, y: node.position.y + NODE_H / 2 };
}

function distance(a: Node<ServiceNodeData>, b: Node<ServiceNodeData>) {
  const ca = center(a);
  const cb = center(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

export function BlastRings({ failedId }: { failedId: string | null }) {
  const nodes = useNodes<Node<ServiceNodeData>>();
  const viewport = useViewport();
  if (!failedId) return null;
  const failed = nodes.find((node) => node.id === failedId);
  if (!failed) return null;
  const origin = center(failed);
  const direct = nodes.filter((node) => node.data.status === "DIRECTLY_AFFECTED");
  const indirect = nodes.filter((node) => node.data.status === "INDIRECTLY_AFFECTED");
  const rDirect = Math.max(
    90,
    ...direct.map((node) => distance(node, failed) + NODE_W / 2 + 18),
  );
  const rIndirect = Math.max(
    rDirect + 56,
    ...indirect.map((node) => distance(node, failed) + NODE_W / 2 + 18),
  );

  return (
    <svg
      className="blast-svg"
      width={1}
      height={1}
      style={{
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      }}
    >
      <circle className="blast-ring indirect" cx={origin.x} cy={origin.y} r={rIndirect} />
      <circle className="blast-ring direct" cx={origin.x} cy={origin.y} r={rDirect} />
      {indirect.length > 0 ? (
        <text className="blast-label" x={origin.x} y={origin.y - rIndirect + 16} textAnchor="middle">
          Indirect impact
        </text>
      ) : null}
      {direct.length > 0 ? (
        <text className="blast-label" x={origin.x} y={origin.y - rDirect + 16} textAnchor="middle">
          Direct impact
        </text>
      ) : null}
    </svg>
  );
}
