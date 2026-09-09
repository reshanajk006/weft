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
  const isHealthy = state === "HEALTHY";
  const isDegraded = state === "DEGRADED" || state === "DIRECTLY_AFFECTED";
  const isUnhealthy = state === "UNHEALTHY" || state === "FAILED" || state === "CRITICAL";

  // Infer semantic service role label
  const roleName =
    data.label.includes("gate") || data.label.includes("ingress") || data.label.includes("checkout")
      ? "Ingress"
      : data.label.includes("db") || data.label.includes("sql") || data.label.includes("postgres")
      ? "Database"
      : data.label.includes("cache") || data.label.includes("redis")
      ? "Cache / Redis"
      : data.label.includes("order") || data.label.includes("auth") || data.label.includes("payment")
      ? "Core Service"
      : "Service";

  const icon = isUnhealthy
    ? "✖"
    : isDegraded
    ? "▲"
    : data.label.includes("checkout")
    ? "⚡"
    : data.label.includes("db")
    ? "▣"
    : data.label.includes("inventory")
    ? "▥"
    : data.label.includes("user")
    ? "웃"
    : data.label.includes("cache")
    ? "▤"
    : "■";

  const dotColor = isHealthy ? "#10b981" : isDegraded ? "#f59e0b" : "#ef4444";
  const borderColor = selected ? "#9CAFC4" : isUnhealthy ? "#ef4444" : isDegraded ? "#f59e0b" : "#374151";

  return (
    <div
      className={`svc-node-card ${selected ? "selected" : ""} ${data.dimmed ? "dimmed" : ""}`}
      style={{
        width: selected ? "215px" : "195px",
        backgroundColor: "#111827",
        borderWidth: selected || isUnhealthy ? "2px" : "1px",
        borderStyle: "solid",
        borderColor: borderColor,
        padding: "12px",
        borderRadius: "2px",
        boxShadow: selected
          ? "0 0 0 2px rgba(156, 175, 196, 0.3), 0 8px 20px rgba(0, 0, 0, 0.6)"
          : "0 4px 12px rgba(0, 0, 0, 0.4)",
        cursor: "pointer",
        position: "relative",
        transition: "all 0.15s ease",
        fontFamily: "'Space Mono', monospace",
        opacity: data.dimmed ? 0.25 : 1,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: "7px",
          height: "7px",
          backgroundColor: "#6B7280",
          border: "1px solid #111827",
          borderRadius: "1px",
        }}
      />

      {/* Node Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <span style={{ color: selected ? "#9CAFC4" : dotColor, fontSize: "11px" }}>{icon}</span>
          <span
            style={{
              fontFamily: "'Space Grotesk', 'Space Mono', sans-serif",
              fontWeight: selected ? 700 : 600,
              fontSize: "12px",
              color: isUnhealthy ? "#ef4444" : "#E5E7EB",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {data.label}
          </span>
        </div>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: dotColor,
            flexShrink: 0,
          }}
          className={isUnhealthy ? "pixel-blink" : undefined}
        />
      </div>

      {/* Node Meta */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "10px",
          color: "#94A3B8",
          borderTop: "1px solid #374151",
          paddingTop: "6px",
        }}
      >
        <span>{roleName}</span>
        <span
          style={{
            color: dotColor,
            fontWeight: 700,
            fontSize: "10px",
          }}
        >
          [{Math.round(data.score)}%] {isHealthy ? "OK" : isUnhealthy ? "FAIL" : "WARN"}
        </span>
      </div>

      {/* Active Target Status Footer if selected */}
      {selected && (
        <div
          style={{
            marginTop: "6px",
            paddingTop: "6px",
            borderTop: "1px solid #374151",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "9px",
            color: "#9CAFC4",
            fontWeight: 700,
          }}
        >
          <span style={{ letterSpacing: "0.06em" }}>► SELECTED</span>
          <span style={{ color: "#E5E7EB" }}>{Math.round(data.score)} CRIT</span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: "7px",
          height: "7px",
          backgroundColor: "#6B7280",
          border: "1px solid #111827",
          borderRadius: "1px",
        }}
      />
    </div>
  );
}
