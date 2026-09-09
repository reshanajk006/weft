import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type ServiceNodeData = {
  label: string;
  health: string;
  status: string;
  score: number;
  dimmed?: boolean;
};

export function ServiceNode({ data, selected }: NodeProps<Node<ServiceNodeData>>) {
  const state = data.status === "NORMAL" || data.status === data.health ? data.health : data.status;
  return (
    <div className={`svc-node ${state}${selected ? " selected" : ""}${data.dimmed ? " dimmed" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="svc-row">
        <span className={`pulse-dot ${state}`} />
        <span className="svc-name">{data.label}</span>
      </div>
      <div className="svc-meta">Health {Math.round(data.score)}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
