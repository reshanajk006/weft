import { useEffect, useState } from "react";

const NODES = [
  { id: "checkout", x: 90, y: 150, label: "checkout" },
  { id: "auth", x: 300, y: 60, label: "auth" },
  { id: "order", x: 300, y: 170, label: "order" },
  { id: "pay", x: 300, y: 280, label: "payment" },
  { id: "user", x: 520, y: 60, label: "user" },
  { id: "inv", x: 520, y: 170, label: "inventory" },
  { id: "db", x: 740, y: 170, label: "db" },
  { id: "cache", x: 520, y: 300, label: "cache" },
  { id: "rec", x: 90, y: 300, label: "recommend" },
  { id: "notify", x: 90, y: 40, label: "notify" },
];

const EDGES: Array<[string, string]> = [
  ["checkout", "auth"],
  ["checkout", "order"],
  ["checkout", "pay"],
  ["auth", "user"],
  ["order", "inv"],
  ["order", "db"],
  ["pay", "db"],
  ["user", "db"],
  ["rec", "cache"],
  ["notify", "user"],
];

function point(id: string) {
  return NODES.find((node) => node.id === id)!;
}

export function HeroGraph() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 9000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <svg viewBox="0 0 860 360" role="img" aria-label="Animated service dependency graph">
      <style>{`
        .weft-edge {
          fill: none;
          stroke: #111;
          stroke-width: 1;
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
          animation: weft-draw 1.1s ease forwards;
        }
        .weft-node {
          opacity: 0;
          animation: weft-node 0.5s ease forwards;
        }
        .weft-fail {
          animation: weft-pulse 1.4s ease 4.2s 3;
        }
        @keyframes weft-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes weft-node {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes weft-pulse {
          0%, 100% { fill: #fff; }
          50% { fill: #111; }
        }
      `}</style>
      {EDGES.map(([from, to], index) => {
        const a = point(from);
        const b = point(to);
        return (
          <path
            key={`${from}-${to}-${tick}`}
            className="weft-edge"
            pathLength={1}
            d={`M ${a.x + 54} ${a.y + 14} C ${(a.x + b.x) / 2 + 54} ${a.y + 14}, ${(a.x + b.x) / 2} ${b.y + 14}, ${b.x} ${b.y + 14}`}
            style={{ animationDelay: `${0.25 + index * 0.12}s` }}
          />
        );
      })}
      {NODES.map((node, index) => (
        <g
          key={`${node.id}-${tick}`}
          className={`weft-node${node.id === "pay" ? " weft-fail" : ""}`}
          style={{ animationDelay: `${0.08 + index * 0.08}s` }}
        >
          <rect x={node.x} y={node.y} width={108} height={28} fill="#fff" stroke="#111" />
          <text x={node.x + 10} y={node.y + 18} fontSize="12" fontFamily="IBM Plex Sans, sans-serif">
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
