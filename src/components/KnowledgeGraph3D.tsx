import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Network, RefreshCw, Zap } from "lucide-react";
import {
  getNodes,
  getEdges,
  NODE_COLORS,
  NODE_TYPE_LABELS,
  riskColor,
} from "@/data/mockData";

type Product = "Insulin" | "IV Saline";

const NODE_SIZES: Record<string, number> = {
  manufacturer: 6,
  port: 9,
  national_wh: 8,
  regional_wh: 6,
  hospital: 5,
};

interface GraphNode {
  id: string;
  label: string;
  type: string;
  lat: number;
  lng: number;
  color: string;
  val: number;
  x?: number;
  y?: number;
  z?: number;
}

export default function KnowledgeGraph3D() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [product, setProduct] = useState<Product>("Insulin");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showParticles, setShowParticles] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const rawNodes = useMemo(() => getNodes(product), [product]);
  const rawEdges = useMemo(() => getEdges(product), [product]);

  const graphData = useMemo(
    () => ({
      nodes: rawNodes.map((n) => ({
        ...n,
        color: NODE_COLORS[n.type as keyof typeof NODE_COLORS] ?? "#888",
        val: NODE_SIZES[n.type] ?? 5,
      })),
      links: rawEdges.map((e) => ({
        ...e,
        source: e.sourceId,
        target: e.targetId,
        color: riskColor(e.flood_risk),
      })),
    }),
    [rawNodes, rawEdges],
  );

  // Wire OrbitControls auto-rotate
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !initialized) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = fg.controls() as any;
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.7;
  }, [autoRotate, initialized]);

  const handleEngineStop = useCallback(() => {
    if (!initialized && fgRef.current) {
      fgRef.current.cameraPosition(
        { x: 200, y: 120, z: 360 },
        { x: 0, y: 0, z: 0 },
        0,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const controls = fgRef.current.controls() as any;
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.7;
      }
      setInitialized(true);
    }
  }, [initialized]);

  const createNodeObject = useCallback((node: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;
    const color = n.color ?? "#3B82F6";
    const size = n.val ?? 6;
    const group = new THREE.Group();

    // Solid core sphere
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(size, 24, 24),
        new THREE.MeshBasicMaterial({ color }),
      ),
    );

    // Inner glow halo (BackSide makes it glow outward)
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(size * 1.9, 16, 16),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.22,
          side: THREE.BackSide,
        }),
      ),
    );

    // Outer diffuse halo
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(size * 3.2, 16, 16),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.07,
          side: THREE.BackSide,
        }),
      ),
    );

    // 3D label — always faces camera
    const sprite = new SpriteText(
      n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label,
    );
    sprite.color = "#e2e8f0";
    sprite.textHeight = 3.5;
    sprite.backgroundColor = "rgba(3,7,18,0.72)";
    sprite.padding = 2;
    sprite.borderRadius = 3;
    sprite.position.y = -(size + 10);
    group.add(sprite);

    return group;
  }, []);

  function handleNodeClick(node: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;
    setSelectedNode(n as GraphNode);
    setAutoRotate(false);
    const distance = 100;
    const mag = Math.hypot(n.x ?? 0.1, n.y ?? 0.1, n.z ?? 0.1);
    const distRatio = 1 + distance / mag;
    fgRef.current?.cameraPosition(
      {
        x: (n.x ?? 0) * distRatio,
        y: (n.y ?? 0) * distRatio,
        z: (n.z ?? 0) * distRatio,
      },
      { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 },
      900,
    );
  }

  function handleBackgroundClick() {
    setSelectedNode(null);
    setAutoRotate(true);
  }

  const totalVolume = useMemo(
    () => graphData.links.reduce((s, l) => s + (l.volume ?? 0), 0),
    [graphData.links],
  );

  const highRiskCount = useMemo(
    () => graphData.links.filter((l) => l.flood_risk > 0.33).length,
    [graphData.links],
  );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#030712",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* CRT scanline overlay for sci-fi feel */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(59,130,246,0.018) 2px, rgba(59,130,246,0.018) 4px)",
        }}
      />

      {/* Radial vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
          background:
            "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 50%, rgba(3,7,18,0.55) 100%)",
        }}
      />

      {/* ── Header ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          background:
            "linear-gradient(180deg, rgba(3,7,18,0.97) 0%, rgba(3,7,18,0) 100%)",
          backdropFilter: "blur(4px)",
        }}
      >
        <Link
          to="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "#93c5fd",
            textDecoration: "none",
            fontSize: 12,
            fontWeight: 500,
            padding: "4px 10px",
            borderRadius: 20,
            border: "1px solid rgba(59,130,246,0.28)",
            background: "rgba(59,130,246,0.07)",
            flexShrink: 0,
          }}
        >
          <ArrowLeft size={13} />
          Dashboard
        </Link>

        <div
          style={{
            width: 1,
            height: 18,
            background: "rgba(255,255,255,0.09)",
            margin: "0 2px",
          }}
        />

        <Network size={15} color="#3B82F6" style={{ flexShrink: 0 }} />
        <span
          style={{
            color: "#e2e8f0",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          Supply Chain
        </span>
        <span
          style={{
            color: "#3B82F6",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          · 3D Graph
        </span>

        <div style={{ flex: 1 }} />

        {/* Product selector */}
        <div
          style={{
            display: "flex",
            gap: 3,
            background: "rgba(255,255,255,0.04)",
            padding: 3,
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {(["Insulin", "IV Saline"] as Product[]).map((p) => (
            <button
              key={p}
              onClick={() => setProduct(p)}
              style={{
                padding: "3px 12px",
                borderRadius: 16,
                border: "none",
                background:
                  product === p ? "rgba(59,130,246,0.3)" : "transparent",
                color: product === p ? "#93c5fd" : "#6b7280",
                fontSize: 12,
                fontWeight: product === p ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.18s",
              }}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={() => setAutoRotate((r) => !r)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 11px",
            borderRadius: 20,
            border: `1px solid ${autoRotate ? "rgba(139,92,246,0.45)" : "rgba(255,255,255,0.1)"}`,
            background: autoRotate
              ? "rgba(139,92,246,0.13)"
              : "rgba(255,255,255,0.03)",
            color: autoRotate ? "#a78bfa" : "#6b7280",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={11} />
          Rotate
        </button>

        <button
          onClick={() => setShowParticles((p) => !p)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 11px",
            borderRadius: 20,
            border: `1px solid ${showParticles ? "rgba(20,184,166,0.45)" : "rgba(255,255,255,0.1)"}`,
            background: showParticles
              ? "rgba(20,184,166,0.10)"
              : "rgba(255,255,255,0.03)",
            color: showParticles ? "#2dd4bf" : "#6b7280",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <Zap size={11} />
          Flow
        </button>
      </div>

      {/* ── 3D Graph canvas ── */}
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#030712"
        width={typeof window !== "undefined" ? window.innerWidth : 1280}
        height={typeof window !== "undefined" ? window.innerHeight : 800}
        nodeThreeObject={createNodeObject}
        nodeThreeObjectExtend={false}
        nodeLabel={() => ""}
        linkColor={(link) => (link as { color?: string }).color ?? "#334155"}
        linkWidth={(link) =>
          0.35 + ((link as { volume?: number }).volume ?? 50) / 95
        }
        linkOpacity={0.5}
        linkDirectionalParticles={showParticles ? 4 : 0}
        linkDirectionalParticleColor={(link) =>
          (link as { color?: string }).color ?? "#3B82F6"
        }
        linkDirectionalParticleWidth={2.2}
        linkDirectionalParticleSpeed={(link) =>
          0.002 + ((link as { volume?: number }).volume ?? 50) / 28000
        }
        linkDirectionalArrowLength={8}
        linkDirectionalArrowRelPos={0.88}
        linkDirectionalArrowColor={(link) =>
          (link as { color?: string }).color ?? "#334155"
        }
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        onEngineStop={handleEngineStop}
        d3AlphaDecay={0.022}
        d3VelocityDecay={0.28}
        cooldownTime={4500}
        warmupTicks={100}
        showNavInfo={false}
      />

      {/* ── Selected node card ── */}
      {selectedNode && (
        <div
          style={{
            position: "absolute",
            top: 68,
            right: 18,
            width: 216,
            background: "rgba(3,7,18,0.88)",
            border: `1px solid ${selectedNode.color}40`,
            borderRadius: 12,
            padding: "15px",
            backdropFilter: "blur(18px)",
            zIndex: 20,
            boxShadow: `0 0 28px ${selectedNode.color}1a, 0 8px 40px rgba(0,0,0,0.6)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: selectedNode.color,
                boxShadow: `0 0 10px ${selectedNode.color}, 0 0 22px ${selectedNode.color}88`,
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <span
              style={{
                color: "#f1f5f9",
                fontWeight: 700,
                fontSize: 13,
                lineHeight: 1.35,
              }}
            >
              {selectedNode.label}
            </span>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}
          >
            {([
              [
                "Type",
                NODE_TYPE_LABELS[
                  selectedNode.type as keyof typeof NODE_TYPE_LABELS
                ] ?? selectedNode.type,
              ],
              ["Latitude", `${selectedNode.lat?.toFixed(4)}°`],
              ["Longitude", `${selectedNode.lng?.toFixed(4)}°`],
            ] as [string, string][]).map(([k, v]) => (
              <div
                key={k}
                style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
              >
                <span style={{ color: "#64748b" }}>{k}</span>
                <span
                  style={{
                    color: "#cbd5e1",
                    fontFamily: "JetBrains Mono, monospace",
                    textAlign: "right",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={handleBackgroundClick}
            style={{
              marginTop: 13,
              width: "100%",
              padding: "5px 0",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.03)",
              color: "#64748b",
              fontSize: 10,
              cursor: "pointer",
              letterSpacing: "0.03em",
            }}
          >
            Dismiss · resume rotation
          </button>
        </div>
      )}

      {/* ── Legend ── */}
      <div
        style={{
          position: "absolute",
          bottom: 72,
          left: 18,
          zIndex: 20,
          background: "rgba(3,7,18,0.72)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10,
          padding: "11px 13px",
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "#3f4f63",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Node types
        </div>
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <div
            key={type}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 5,
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                boxShadow: `0 0 5px ${color}`,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#94a3b8", fontSize: 10.5 }}>
              {NODE_TYPE_LABELS[type as keyof typeof NODE_TYPE_LABELS]}
            </span>
          </div>
        ))}

        <div
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "#3f4f63",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Route risk
        </div>
        {(
          [
            ["Low", "#22C55E"],
            ["Medium", "#F97316"],
            ["High", "#EF4444"],
          ] as [string, string][]
        ).map(([label, color]) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 5,
            }}
          >
            <div
              style={{
                width: 20,
                height: 3,
                borderRadius: 2,
                background: color,
                boxShadow: `0 0 5px ${color}`,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#94a3b8", fontSize: 10.5 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Stats bar ── */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          background: "rgba(3,7,18,0.86)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 26,
          overflow: "hidden",
          backdropFilter: "blur(14px)",
          zIndex: 20,
          boxShadow: "0 4px 30px rgba(0,0,0,0.4)",
          whiteSpace: "nowrap",
        }}
      >
        {(
          [
            { label: "NODES", value: String(graphData.nodes.length), color: "#3B82F6" },
            { label: "ROUTES", value: String(graphData.links.length), color: "#8B5CF6" },
            { label: "AT RISK", value: String(highRiskCount), color: "#F97316" },
            { label: "VOLUME", value: `£${totalVolume}M`, color: "#14B8A6" },
          ] as { label: string; value: string; color: string }[]
        ).map(({ label, value, color }, i, arr) => (
          <div
            key={label}
            style={{
              padding: "8px 20px",
              textAlign: "center",
              borderRight:
                i < arr.length - 1
                  ? "1px solid rgba(255,255,255,0.06)"
                  : undefined,
            }}
          >
            <div style={{ color, fontWeight: 700, fontSize: 16, lineHeight: 1 }}>
              {value}
            </div>
            <div
              style={{
                color: "#374151",
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                marginTop: 4,
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Interaction hint ── */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 18,
          zIndex: 20,
          color: "#1f2937",
          fontSize: 10,
          textAlign: "right",
          lineHeight: 1.8,
          userSelect: "none",
        }}
      >
        Click node to inspect
        <br />
        Drag · Scroll to navigate
      </div>
    </div>
  );
}
