import { useMemo, useState } from "react";
import { NODE_COLORS, NODE_TYPE_LABELS, riskColor, volumeToWidth } from "@/data/mockData";

interface Node {
  id: string;
  label: string;
  type: string;
  lat: number;
  lng: number;
}

interface Edge {
  sourceId: string;
  targetId: string;
  volume: number;
  flood_risk: number;
}

interface KnowledgeGraphProps {
  nodes: Node[];
  edges: Edge[];
  disruptedSet: Set<string>;
  activeWarning: boolean;
  theme: "dark" | "light";
  product: string;
}

const LAYER_ORDER: Record<string, number> = {
  manufacturer: 0,
  port: 1,
  national_wh: 2,
  regional_wh: 3,
  hospital: 4,
};

const LAYER_LABELS: Record<string, string> = {
  manufacturer: "Manufacturers",
  port: "Ports",
  national_wh: "National WH",
  regional_wh: "Regional WH",
  hospital: "Hospitals",
};

const NODE_RADIUS = 10;
const LAYER_X_STEP = 210;
const LAYER_X_START = 110;
const NODE_Y_START = 80;
const NODE_Y_STEP = 58;
const SVG_PADDING_RIGHT = 60;

function cubicBezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
): string {
  const dx = x2 - x1;
  const cx1 = x1 + dx * 0.45;
  const cx2 = x2 - dx * 0.45;
  return `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;
}

export default function KnowledgeGraph({
  nodes,
  edges,
  disruptedSet,
  activeWarning,
  theme,
}: KnowledgeGraphProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const isDark = theme === "dark";

  // Group nodes by layer type
  const layers = useMemo(() => {
    const byLayer: Record<number, Node[]> = {};
    for (const n of nodes) {
      const layer = LAYER_ORDER[n.type] ?? 99;
      if (!byLayer[layer]) byLayer[layer] = [];
      byLayer[layer].push(n);
    }
    return byLayer;
  }, [nodes]);

  // Compute (x, y) position for each node
  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    for (const [layerStr, layerNodes] of Object.entries(layers)) {
      const layer = Number(layerStr);
      const x = LAYER_X_START + layer * LAYER_X_STEP;
      const totalH = (layerNodes.length - 1) * NODE_Y_STEP;
      layerNodes.forEach((n, i) => {
        pos[n.id] = {
          x,
          y: NODE_Y_START + (layerNodes.length === 1 ? totalH / 2 : i * NODE_Y_STEP),
        };
      });
    }
    return pos;
  }, [layers]);

  const layerCount = Object.keys(layers).length;
  const maxNodesInLayer = Math.max(...Object.values(layers).map((l) => l.length));
  const svgWidth = LAYER_X_START + layerCount * LAYER_X_STEP + SVG_PADDING_RIGHT;
  const svgHeight = Math.max(420, NODE_Y_START + maxNodesInLayer * NODE_Y_STEP + 60);

  const textColor = isDark ? "#c8cfde" : "#475569";
  const mutedColor = isDark ? "#8a93a8" : "#94a3b8";
  const surfaceBg = isDark ? "#0d1117" : "#f8fafc";
  const borderColor = isDark ? "#2a3244" : "#e2e8f0";
  const tooltipBg = isDark ? "#0d1117" : "#ffffff";
  const tooltipText = isDark ? "#e5e7eb" : "#1e293b";
  const markerStroke = isDark ? "#0f1117" : "#ffffff";

  const hoveredNodeData = hoveredNode ? nodes.find((n) => n.id === hoveredNode) : null;
  const hoveredNodePos = hoveredNode ? positions[hoveredNode] : null;

  const hoveredEdgeData = hoveredEdge
    ? edges.find((e) => `${e.sourceId}->${e.targetId}` === hoveredEdge)
    : null;
  const hoveredEdgeMidpoint = useMemo(() => {
    if (!hoveredEdge) return null;
    const [sId, tId] = hoveredEdge.split("->");
    const s = positions[sId];
    const t = positions[tId];
    if (!s || !t) return null;
    return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  }, [hoveredEdge, positions]);

  return (
    <div
      className="mr-graph"
      style={{
        width: "100%",
        height: "100%",
        background: surfaceBg,
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }}
      >
        <defs>
          {/* Glow filter for hovered nodes */}
          <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-node" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Arrow marker for edges */}
          {edges.map((e) => {
            const key = `${e.sourceId}->${e.targetId}`;
            const color = disruptedSet.has(key) ? "#EF4444" : riskColor(e.flood_risk);
            return (
              <marker
                key={`arrow-${key}`}
                id={`arrow-${e.sourceId}-${e.targetId}`}
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L6,3 z" fill={color} opacity={0.8} />
              </marker>
            );
          })}
        </defs>

        {/* Layer column header labels */}
        {Object.entries(LAYER_ORDER).map(([type, layer]) => {
          if (!layers[layer]) return null;
          const x = LAYER_X_START + layer * LAYER_X_STEP;
          return (
            <text
              key={type}
              x={x}
              y={28}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={600}
              letterSpacing={1.2}
              textTransform="uppercase"
              fill={mutedColor}
              style={{ textTransform: "uppercase" }}
            >
              {LAYER_LABELS[type]}
            </text>
          );
        })}

        {/* Subtle vertical column separators */}
        {Object.entries(LAYER_ORDER).map(([type, layer]) => {
          if (!layers[layer] || layer === 0) return null;
          const x = LAYER_X_START + layer * LAYER_X_STEP - LAYER_X_STEP / 2;
          return (
            <line
              key={`sep-${type}`}
              x1={x} y1={40}
              x2={x} y2={svgHeight - 20}
              stroke={borderColor}
              strokeWidth={1}
              strokeDasharray="3 5"
              opacity={0.5}
            />
          );
        })}

        {/* Edges */}
        {edges.map((e) => {
          const s = positions[e.sourceId];
          const t = positions[e.targetId];
          if (!s || !t) return null;
          const key = `${e.sourceId}->${e.targetId}`;
          const isDisrupted = disruptedSet.has(key);
          const isHovered = hoveredEdge === key;
          const dim = activeWarning && !isDisrupted && !isHovered;
          const opacity = isHovered ? 1 : dim ? 0.1 : 0.72;
          const color = isDisrupted ? "#EF4444" : riskColor(e.flood_risk);
          const width = volumeToWidth(e.volume);

          return (
            <path
              key={key}
              d={cubicBezierPath(s.x + NODE_RADIUS, s.y, t.x - NODE_RADIUS, t.y)}
              fill="none"
              stroke={color}
              strokeWidth={isHovered ? width + 2 : width}
              strokeOpacity={opacity}
              strokeDasharray={isDisrupted ? "7 5" : undefined}
              markerEnd={`url(#arrow-${e.sourceId}-${e.targetId})`}
              className="mr-graph-edge"
              style={{ cursor: "pointer", transition: "stroke-opacity 0.25s, stroke-width 0.2s" }}
              onMouseEnter={() => setHoveredEdge(key)}
              onMouseLeave={() => setHoveredEdge(null)}
              filter={isHovered ? "url(#glow-blue)" : undefined}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const pos = positions[n.id];
          if (!pos) return null;
          const color = NODE_COLORS[n.type as keyof typeof NODE_COLORS] ?? "#888";
          const isHovered = hoveredNode === n.id;
          const isConnectedToHoveredEdge = hoveredEdge
            ? hoveredEdge.startsWith(n.id + "->") || hoveredEdge.endsWith("->" + n.id)
            : false;
          const emphasize = isHovered || isConnectedToHoveredEdge;

          return (
            <g
              key={n.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredNode(n.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Outer glow ring when hovered */}
              {emphasize && (
                <circle
                  r={NODE_RADIUS + 6}
                  fill={color}
                  opacity={0.18}
                />
              )}
              {/* Node ring (border) */}
              <circle
                r={NODE_RADIUS + 2.5}
                fill={markerStroke}
                opacity={emphasize ? 1 : 0.9}
              />
              {/* Node fill */}
              <circle
                r={NODE_RADIUS}
                fill={color}
                filter={emphasize ? "url(#glow-node)" : undefined}
                style={{ transition: "r 0.15s" }}
              />
              {/* Node label */}
              <text
                x={0}
                y={NODE_RADIUS + 14}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={emphasize ? 600 : 400}
                fill={emphasize ? textColor : mutedColor}
                style={{ transition: "fill 0.15s, font-weight 0.15s", pointerEvents: "none" }}
              >
                {n.label.length > 18 ? n.label.slice(0, 16) + "…" : n.label}
              </text>
            </g>
          );
        })}

        {/* Node tooltip */}
        {hoveredNodeData && hoveredNodePos && (
          <g transform={`translate(${hoveredNodePos.x + 18}, ${hoveredNodePos.y - 42})`}>
            <rect
              x={0} y={0} width={160} height={52}
              rx={6}
              fill={tooltipBg}
              stroke={borderColor}
              strokeWidth={1}
              filter="url(#glow-blue)"
              style={{ filter: `drop-shadow(0 4px 16px rgba(0,0,0,0.35))` }}
            />
            <text x={10} y={18} fontSize={10} fontWeight={600} fill={tooltipText}>
              {hoveredNodeData.label}
            </text>
            <text x={10} y={32} fontSize={9} fill={mutedColor}>
              {NODE_TYPE_LABELS[hoveredNodeData.type as keyof typeof NODE_TYPE_LABELS]}
            </text>
            <text x={10} y={46} fontSize={8.5} fill={mutedColor} fontFamily="JetBrains Mono, monospace">
              {hoveredNodeData.lat.toFixed(3)}°N {Math.abs(hoveredNodeData.lng).toFixed(3)}°{hoveredNodeData.lng < 0 ? "W" : "E"}
            </text>
          </g>
        )}

        {/* Edge tooltip */}
        {hoveredEdgeData && hoveredEdgeMidpoint && (
          <g transform={`translate(${hoveredEdgeMidpoint.x - 80}, ${hoveredEdgeMidpoint.y - 66})`}>
            <rect
              x={0} y={0} width={160} height={62}
              rx={6}
              fill={tooltipBg}
              stroke={borderColor}
              strokeWidth={1}
              style={{ filter: `drop-shadow(0 4px 16px rgba(0,0,0,0.35))` }}
            />
            <text x={10} y={18} fontSize={9} fill={mutedColor}>Volume</text>
            <text x={70} y={18} fontSize={9.5} fontWeight={600} fill={tooltipText} fontFamily="JetBrains Mono, monospace">
              £{hoveredEdgeData.volume}M/yr
            </text>
            <text x={10} y={34} fontSize={9} fill={mutedColor}>Flood risk</text>
            <text x={70} y={34} fontSize={9.5} fontWeight={600} fill={riskColor(hoveredEdgeData.flood_risk)} fontFamily="JetBrains Mono, monospace">
              {(hoveredEdgeData.flood_risk * 100).toFixed(0)}%
            </text>
            <text x={10} y={50} fontSize={9} fill={mutedColor}>Route</text>
            <text x={10} y={60} fontSize={8.5} fill={tooltipText} fontFamily="JetBrains Mono, monospace">
              {hoveredEdgeData.sourceId} → {hoveredEdgeData.targetId}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
