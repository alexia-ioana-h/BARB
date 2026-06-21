import { Fragment, useEffect, useMemo, useState } from "react";
import { Sun, Moon, Network, FileUp } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Tooltip as LTooltip } from "react-leaflet";
import KnowledgeGraph from "@/components/KnowledgeGraph";
import DocumentIngestion from "@/components/DocumentIngestion";
import {
  NODE_COLORS,
  NODE_TYPE_LABELS,
  WARNINGS,
  SEVERITY_COLORS,
  KIND_ICON,
  getNodes,
  getEdges,
  riskColor,
  riskLevel,
  volumeToWidth,
} from "@/data/mockData";

type Product = "Insulin" | "IV Saline";

const UK_BBOX = { minLat: 49.5, maxLat: 59, minLng: -8, maxLng: 2 };
const inUK = (lat: number, lng: number) =>
  lat >= UK_BBOX.minLat && lat <= UK_BBOX.maxLat && lng >= UK_BBOX.minLng && lng <= UK_BBOX.maxLng;

// Nearest export sea port for each foreign manufacturer.
// Truck routes them from site → export port, then a sea leg → UK arrival port.
const EXPORT_PORTS: Record<string, { label: string; lat: number; lng: number }> = {
  glooko:    { label: "Port of Oakland",    lat: 37.7955, lng: -122.2790 },
  insulet:   { label: "Port of Boston",     lat: 42.3540, lng:  -71.0489 },
  tandem:    { label: "Port of Long Beach", lat: 33.7540, lng: -118.2160 },
  roche:     { label: "Port of NY/NJ",      lat: 40.6700, lng:  -74.0500 },
  sooil:     { label: "Port of Busan",      lat: 35.1014, lng:  129.0403 },
  menarini:  { label: "Port of Livorno",    lat: 43.5547, lng:   10.3083 },
  ypsomed:   { label: "Port of Rotterdam",  lat: 51.9244, lng:    4.4777 },
  abbott:    { label: "Port of Rosslare",   lat: 52.2469, lng:   -6.3389 },
  dexcom:    { label: "Port of Galway",     lat: 53.2700, lng:   -9.0500 },
  medtronic: { label: "Port of Galway",     lat: 53.2700, lng:   -9.0500 },
  // airliquide is UK-domestic — no sea leg needed.
};

// For inland UK destination "ports", the sea leg arrives at a real coastal port,
// then a final truck leg covers the inland portion.
const UK_ARRIVAL_PORTS: Record<string, { label: string; lat: number; lng: number }> = {
  heath: { label: "London Gateway", lat: 51.5050, lng: 0.4790 },
  // felix is itself coastal, no arrival redirect needed
};

// Quadratic bezier curve between two ports — gives a curved "sea lane" instead
// of a straight rhumb line. Offset perpendicular to the segment by ~22% of length.
function seaCurve(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  steps = 48,
): [number, number][] {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1;
  // perpendicular (rotated +90deg)
  const px = -dy / len;
  const py = dx / len;
  // bow the curve "northward" relative to travel direction so trans-oceanic
  // arcs lift off the equator a bit, like real great-circle ship lanes.
  const sign = dx >= 0 ? 1 : -1;
  const off = len * 0.22;
  const cx = (a.lng + b.lng) / 2 + px * off * sign;
  const cy = (a.lat + b.lat) / 2 + py * off * sign;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lng = (1 - t) * (1 - t) * a.lng + 2 * (1 - t) * t * cx + t * t * b.lng;
    const lat = (1 - t) * (1 - t) * a.lat + 2 * (1 - t) * t * cy + t * t * b.lat;
    out.push([lat, lng]);
  }
  return out;
}

const routeCache = new Map<string, [number, number][]>();

async function fetchRoad(
  s: { lat: number; lng: number },
  t: { lat: number; lng: number },
): Promise<[number, number][] | null> {
  const key = `${s.lat},${s.lng}->${t.lat},${t.lng}`;
  if (routeCache.has(key)) return routeCache.get(key)!;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${s.lng},${s.lat};${t.lng},${t.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coords: [number, number][] = data?.routes?.[0]?.geometry?.coordinates?.map(
      ([lng, lat]: [number, number]) => [lat, lng],
    );
    if (!coords || coords.length < 2) return null;
    routeCache.set(key, coords);
    return coords;
  } catch {
    return null;
  }
}

type LL = { lat: number; lng: number };

async function fetchOsrmRoute(
  waypoints: LL[],
): Promise<{ coords: [number, number][]; durationSec: number; distanceM: number } | null> {
  try {
    const path = waypoints.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.routes?.[0];
    if (!r) return null;
    const coords: [number, number][] = r.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => [lat, lng],
    );
    return { coords, durationSec: r.duration, distanceM: r.distance };
  } catch {
    return null;
  }
}

function detourWaypoint(s: LL, t: LL, w: { lat: number; lng: number; radiusKm: number }): LL {
  const dx = t.lng - s.lng;
  const dy = t.lat - s.lat;
  const len = Math.hypot(dx, dy) || 1;
  // perpendicular unit vector
  const px = -dy / len;
  const py = dx / len;
  // offset in degrees: ~111km per degree
  const off = (w.radiusKm + 25) / 111;
  // pick the side away from the warning center, relative to segment midpoint
  const mx = (s.lng + t.lng) / 2 - w.lng;
  const my = (s.lat + t.lat) / 2 - w.lat;
  const sign = px * mx + py * my >= 0 ? 1 : -1;
  return {
    lat: w.lat + sign * py * off,
    lng: w.lng + sign * px * off,
  };
}

function useRoadGeometries(
  edges: { sourceId: string; targetId: string }[],
  nodeMap: Record<string, { lat: number; lng: number }>,
) {
  const [geos, setGeos] = useState<Record<string, [number, number][]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const e of edges) {
        const s = nodeMap[e.sourceId];
        const t = nodeMap[e.targetId];
        if (!s || !t) continue;
        const key = `${e.sourceId}->${e.targetId}`;
        const exp = EXPORT_PORTS[e.sourceId];

        // Pure truck leg — both endpoints in a road network we trust.
        if (!exp) {
          if (!inUK(s.lat, s.lng) || !inUK(t.lat, t.lng)) {
            // domestic-but-not-UK (rare): straight line fallback
            setGeos((g) => ({ ...g, [key]: [[s.lat, s.lng], [t.lat, t.lng]] }));
            continue;
          }
          const coords = await fetchRoad(s, t);
          if (cancelled) return;
          if (coords) setGeos((g) => ({ ...g, [key]: coords }));
          continue;
        }

        // Composite leg: truck → sea → truck
        const arrival = UK_ARRIVAL_PORTS[e.targetId] ?? { lat: t.lat, lng: t.lng };
        // Leg 1: truck from manufacturer → export port (OSRM works for US/EU/KR/IE).
        const truck1 = (await fetchRoad(s, exp)) ?? [
          [s.lat, s.lng],
          [exp.lat, exp.lng],
        ];
        if (cancelled) return;
        // Leg 2: curved sea lane.
        const sea = seaCurve(exp, arrival);
        // Leg 3: truck from arrival port → final UK port (only if inland).
        let truck2: [number, number][] = [];
        if (UK_ARRIVAL_PORTS[e.targetId]) {
          const inland = await fetchRoad(arrival, t);
          if (cancelled) return;
          truck2 = inland ?? [
            [arrival.lat, arrival.lng],
            [t.lat, t.lng],
          ];
        }
        const combined: [number, number][] = [...truck1, ...sea, ...truck2];
        setGeos((g) => ({ ...g, [key]: combined }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [edges, nodeMap]);

  return geos;
}

// ---------------- Agent recommendations ----------------

interface Recommendation {
  id: string; // warningId::edgeKey
  warningId: string;
  edgeKey: string;
  sourceLabel: string;
  targetLabel: string;
  altCoords: [number, number][];
  baselineMin: number;
  altMin: number;
  delayDeltaMin: number;
  costDeltaGBP: number;
  rationale: string;
  via: string; // human waypoint description
}

interface Decision {
  status: "approved" | "rejected";
  at: string; // ISO timestamp
  reason?: string;
}

function approxPlaceName(p: LL): string {
  // tiny lookup — find nearest of a fixed list of UK landmarks for human label
  const places: { name: string; lat: number; lng: number }[] = [
    { name: "Birmingham", lat: 52.48, lng: -1.9 },
    { name: "Oxford", lat: 51.75, lng: -1.26 },
    { name: "Cambridge", lat: 52.2, lng: 0.12 },
    { name: "Reading", lat: 51.45, lng: -0.97 },
    { name: "Northampton", lat: 52.24, lng: -0.9 },
    { name: "Sheffield", lat: 53.38, lng: -1.47 },
    { name: "Nottingham", lat: 52.95, lng: -1.15 },
    { name: "Stoke", lat: 53.0, lng: -2.18 },
    { name: "Carlisle", lat: 54.89, lng: -2.94 },
    { name: "Exeter", lat: 50.72, lng: -3.53 },
    { name: "Cardiff", lat: 51.48, lng: -3.18 },
    { name: "Norwich", lat: 52.63, lng: 1.3 },
    { name: "Peterborough", lat: 52.57, lng: -0.24 },
    { name: "Coventry", lat: 52.41, lng: -1.51 },
  ];
  let best = places[0];
  let bd = Infinity;
  for (const pl of places) {
    const d = Math.hypot(pl.lat - p.lat, pl.lng - p.lng);
    if (d < bd) {
      bd = d;
      best = pl;
    }
  }
  return best.name;
}

function NodeLabel({ label }: { label: string }) {
  return (
    <LTooltip permanent direction="top" offset={[0, -8]} className="mr-node-label">
      {label}
    </LTooltip>
  );
}

export default function MediRouteDashboard() {
  const [product, setProduct] = useState<Product>("Insulin");
  const [graphMode, setGraphMode] = useState<"2d" | "graph">("2d");
  const [viewMode, setViewMode] = useState<"international" | "domestic">("international");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("mr-theme") as "dark" | "light") || "dark";
    }
    return "dark";
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeWarningId, setActiveWarningId] = useState<string | null>(null);
  const [recsByWarning, setRecsByWarning] = useState<Record<string, Recommendation[]>>({});
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [ingestOpen, setIngestOpen] = useState(false);
  const [extraNodes, setExtraNodes] = useState<{ id: string; label: string; type: string; lat: number; lng: number }[]>([]);
  const [extraEdges, setExtraEdges] = useState<{ sourceId: string; targetId: string; volume: number; flood_risk: number }[]>([]);
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("mr-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const activeWarning = useMemo(
    () => WARNINGS.find((w) => w.id === activeWarningId) ?? null,
    [activeWarningId],
  );
  const disruptedSet = useMemo(
    () => new Set(activeWarning?.disrupts ?? []),
    [activeWarning],
  );

  const nodes = useMemo(() => [...getNodes(product), ...extraNodes], [product, extraNodes]);
  const allEdges = useMemo(() => [...getEdges(product), ...extraEdges], [product, extraEdges]);
  const nodeMap = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  // In domestic mode hide all international legs (manufacturer → export port / sea).
  const isInternationalEdge = (e: { sourceId: string }) => !!EXPORT_PORTS[e.sourceId];
  const edges = useMemo(
    () => (viewMode === "international" ? allEdges : allEdges.filter((e) => !isInternationalEdge(e))),
    [allEdges, viewMode],
  );
  const roadGeos = useRoadGeometries(edges, nodeMap);

  // Map of approved alternative route geometry by edgeKey, used to redraw map
  const approvedAltGeo = useMemo(() => {
    const out: Record<string, [number, number][]> = {};
    for (const recs of Object.values(recsByWarning)) {
      for (const r of recs) {
        const d = decisions[r.id];
        if (d?.status === "approved") out[r.edgeKey] = r.altCoords;
      }
    }
    return out;
  }, [recsByWarning, decisions]);

  const previewRec = useMemo(() => {
    if (!selectedRecId) return null;
    for (const recs of Object.values(recsByWarning)) {
      const r = recs.find((x) => x.id === selectedRecId);
      if (r) return r;
    }
    return null;
  }, [selectedRecId, recsByWarning]);
  // Clear preview when changing the active warning
  useEffect(() => {
    setSelectedRecId(null);
  }, [activeWarningId]);

  async function generateRecommendations(warningId: string) {
    const w = WARNINGS.find((x) => x.id === warningId);
    if (!w) return;
    setGenerating((g) => ({ ...g, [warningId]: true }));
    const out: Recommendation[] = [];
    for (const edgeKey of w.disrupts) {
      const [sId, tId] = edgeKey.split("->");
      const s = nodeMap[sId];
      const t = nodeMap[tId];
      // Try across both products' node maps so warnings always resolve
      const fallbackNodes = Object.fromEntries(
        [...getNodes("Insulin"), ...getNodes("IV Saline")].map((n) => [n.id, n]),
      );
      const src = s ?? fallbackNodes[sId];
      const tgt = t ?? fallbackNodes[tId];
      if (!src || !tgt) continue;

      // baseline (direct)
      const baseline = await fetchOsrmRoute([src, tgt]);
      // detour via waypoint outside the geofence
      const wp = detourWaypoint(src, tgt, w);
      const alt = await fetchOsrmRoute([src, wp, tgt]);

      // fallback synth values if OSRM fails (e.g. cross-channel)
      const baselineMin = baseline ? Math.round(baseline.durationSec / 60) : 120;
      const altMin = alt
        ? Math.round(alt.durationSec / 60)
        : Math.round(baselineMin * 1.35);
      const delayDeltaMin = Math.max(5, altMin - baselineMin);

      // Cost model: incremental £/min driving + extra distance fuel
      // £1.10/min HGV labour+truck + £0.42/km diesel & wear
      const distanceKmDelta = alt && baseline
        ? Math.max(0, (alt.distanceM - baseline.distanceM) / 1000)
        : delayDeltaMin * 1.1; // approx
      const costDeltaGBP = Math.round(delayDeltaMin * 1.1 + distanceKmDelta * 0.42);

      const altCoords =
        alt?.coords ?? [
          [src.lat, src.lng],
          [wp.lat, wp.lng],
          [tgt.lat, tgt.lng],
        ];

      const via = approxPlaceName(wp);
      const rationale =
        `Re-routed via ${via} to bypass the ${w.kind} geofence (` +
        `${w.radiusKm} km radius, ${w.severity}). Adds ~${delayDeltaMin} min ` +
        `but keeps the corridor open during the ${w.duration} window.`;

      out.push({
        id: `${w.id}::${edgeKey}`,
        warningId: w.id,
        edgeKey,
        sourceLabel: src.label,
        targetLabel: tgt.label,
        altCoords,
        baselineMin,
        altMin,
        delayDeltaMin,
        costDeltaGBP,
        rationale,
        via,
      });
    }
    setRecsByWarning((m) => ({ ...m, [warningId]: out }));
    setGenerating((g) => ({ ...g, [warningId]: false }));
  }

  function approveRec(rec: Recommendation) {
    setDecisions((d) => ({
      ...d,
      [rec.id]: { status: "approved", at: new Date().toISOString() },
    }));
  }

  function rejectRec(recId: string, reason: string) {
    setDecisions((d) => ({
      ...d,
      [recId]: { status: "rejected", at: new Date().toISOString(), reason: reason || undefined },
    }));
    if (reason) {
      // Log for later threshold tuning. In a real app this hits a backend.
      console.info("[MediRoute] rejection logged", { recId, reason, at: new Date().toISOString() });
    }
    setRejectingId(null);
    setRejectReason("");
  }

  const tableRows = useMemo(
    () =>
      [...edges]
        .map((e) => ({
          ...e,
          source: nodeMap[e.sourceId],
          target: nodeMap[e.targetId],
        }))
        .sort((a, b) => b.flood_risk - a.flood_risk),
    [edges, nodeMap],
  );

  return (
    <div className="mr-root">
      <div className="mr-map-wrap">
        <div className="mr-overlay-controls">
          <div className="mr-overlay-group">
            <div className="mr-section-title">Product</div>
            <div className="mr-pills">
              {(["Insulin", "IV Saline"] as Product[]).map((p) => (
                <button
                  key={p}
                  className={`mr-pill${product === p ? " active" : ""}`}
                  onClick={() => setProduct(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="mr-overlay-group">
            <div className="mr-section-title">Theme</div>
            <div className="mr-pills">
              <button
                className={`mr-pill${theme === "light" ? " active" : ""}`}
                onClick={() => setTheme("light")}
                title="Light mode"
              >
                <Sun size={14} style={{ display: "block", margin: "0 auto" }} />
              </button>
              <button
                className={`mr-pill${theme === "dark" ? " active" : ""}`}
                onClick={() => setTheme("dark")}
                title="Dark mode"
              >
                <Moon size={14} style={{ display: "block", margin: "0 auto" }} />
              </button>
            </div>
          </div>
          <div className="mr-overlay-group">
            <div className="mr-section-title">Display</div>
            <div className="mr-pills">
              <button
                className={`mr-pill${graphMode === "2d" ? " active" : ""}`}
                onClick={() => setGraphMode("2d")}
              >
                Map
              </button>
              <button
                className={`mr-pill${graphMode === "graph" ? " active" : ""}`}
                onClick={() => setGraphMode("graph")}
              >
                Graph
              </button>
            </div>
          </div>
          <div className="mr-overlay-group">
            <div className="mr-section-title">Data</div>
            <button
              className="mr-pill"
              onClick={() => setIngestOpen(true)}
              title="Ingest supply chain document"
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <FileUp size={13} />
              Ingest
              {(extraNodes.length > 0 || extraEdges.length > 0) && (
                <span
                  style={{
                    background: "#3B82F6",
                    color: "#fff",
                    borderRadius: 10,
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "1px 5px",
                    lineHeight: 1.4,
                  }}
                >
                  +{extraNodes.length + extraEdges.length}
                </span>
              )}
            </button>
          </div>
          <div className="mr-overlay-group">
            <div className="mr-section-title">3D View</div>
            <Link
              to="/graph3d"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid rgba(59,130,246,0.45)",
                background: "rgba(59,130,246,0.12)",
                color: "#93c5fd",
                textDecoration: "none",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              <Network size={13} />
              3D Graph
            </Link>
          </div>
        </div>

        <div className="mr-legend">
          {Object.entries(NODE_TYPE_LABELS).map(([k, v]) => (
            <div key={k} className="mr-legend-item">
              <span className="mr-dot" style={{ background: NODE_COLORS[k as keyof typeof NODE_COLORS] }} />
              <span>{v}</span>
            </div>
          ))}
        </div>

        {graphMode === "graph" ? (
          <KnowledgeGraph
            nodes={nodes}
            edges={edges}
            disruptedSet={disruptedSet}
            activeWarning={activeWarning !== null}
            theme={theme}
            product={product}
          />
        ) : null}
        {graphMode === "2d" && <MapContainer
          center={[54, -2]}
          zoom={6}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
          className={theme === "dark" ? "dark" : ""}
        >
          <TileLayer
            key={theme}
            url={
              theme === "dark"
                ? "https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png"
                : "https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png"
            }
            attribution='&copy; OpenStreetMap &copy; CartoDB'
          />
          {edges.map((e, i) => {
              const s = nodeMap[e.sourceId];
              const t = nodeMap[e.targetId];
              if (!s || !t) return null;
              const key = `${e.sourceId}->${e.targetId}`;
              const road = roadGeos[key];
              const positions: [number, number][] =
                road ?? [
                  [s.lat, s.lng],
                  [t.lat, t.lng],
                ];
              const isDisrupted = disruptedSet.has(key);
              const altPositions = approvedAltGeo[key];
              const isPreviewing = previewRec?.edgeKey === key;
              const dim = activeWarning && !isDisrupted && !isPreviewing;
              const previewOpacity = isPreviewing
                ? 1
                : altPositions
                  ? 0.18
                  : dim
                    ? 0.18
                    : 0.9;
              return (
                <Fragment key={`${product}-${i}`}>
                <Polyline
                  positions={positions}
                  pathOptions={{
                    color: isDisrupted ? "#EF4444" : riskColor(e.flood_risk),
                    weight: isPreviewing
                      ? volumeToWidth(e.volume) + 3
                      : isDisrupted
                        ? volumeToWidth(e.volume) + 2
                        : volumeToWidth(e.volume),
                    opacity: previewOpacity,
                    dashArray: isDisrupted ? "8 6" : undefined,
                    className: "mr-edge",
                  }}
                >
                  <LTooltip
                    sticky
                    direction="top"
                    offset={[0, -4]}
                    className="mr-tooltip"
                  >
                    <div className="mr-tt">
                      <div className="mr-tt-row">
                        <span>Route</span>
                        <b>{s.label} → {t.label}</b>
                      </div>
                      <div className="mr-tt-row">
                        <span>Volume</span>
                        <b className="mono">£{e.volume}M/yr</b>
                      </div>
                      <div className="mr-tt-row">
                        <span>Flood risk</span>
                        <b className="mono">{(e.flood_risk * 100).toFixed(0)}%</b>
                      </div>
                      <div className="mr-tt-row">
                        <span>Risk level</span>
                        <b style={{ color: riskColor(e.flood_risk) }}>{riskLevel(e.flood_risk)}</b>
                      </div>
                    </div>
                  </LTooltip>
                </Polyline>
                {isPreviewing && previewRec && (
                  <Polyline
                    positions={previewRec.altCoords}
                    pathOptions={{
                      color: "#3B82F6",
                      weight: volumeToWidth(e.volume) + 2,
                      opacity: 1,
                      className: "mr-edge mr-edge-preview",
                    }}
                  >
                    <LTooltip sticky direction="top" offset={[0, -4]} className="mr-tooltip">
                      <div className="mr-tt">
                        <div className="mr-tt-row"><span>Status</span><b style={{color:"#3B82F6"}}>Proposed reroute</b></div>
                        <div className="mr-tt-row"><span>Detour via</span><b>{previewRec.via}</b></div>
                        <div className="mr-tt-row"><span>Δ time</span><b className="mono">+{previewRec.delayDeltaMin} min</b></div>
                        <div className="mr-tt-row"><span>Δ cost</span><b className="mono">+£{previewRec.costDeltaGBP}</b></div>
                      </div>
                    </LTooltip>
                  </Polyline>
                )}
                {altPositions && (
                  <Polyline
                    positions={altPositions}
                    pathOptions={{
                      color: "#22C55E",
                      weight: volumeToWidth(e.volume) + 1,
                      opacity: 0.95,
                      dashArray: "2 6",
                      className: "mr-edge",
                    }}
                  >
                    <LTooltip sticky direction="top" offset={[0, -4]} className="mr-tooltip">
                      <div className="mr-tt">
                        <div className="mr-tt-row"><span>Status</span><b style={{color:"#22C55E"}}>Agent reroute · approved</b></div>
                        <div className="mr-tt-row"><span>Route</span><b>{s.label} → {t.label}</b></div>
                      </div>
                    </LTooltip>
                  </Polyline>
                )}
                </Fragment>
              );
            })}

          {activeWarning && (
            <Circle
              center={[activeWarning.lat, activeWarning.lng]}
              radius={activeWarning.radiusKm * 1000}
              pathOptions={{
                color: SEVERITY_COLORS[activeWarning.severity],
                fillColor: SEVERITY_COLORS[activeWarning.severity],
                fillOpacity: 0.12,
                weight: 1.5,
                dashArray: "4 4",
              }}
            />
          )}

          {nodes.map((n) => (
              <CircleMarker
                key={n.id}
                center={[n.lat, n.lng]}
                radius={7}
                pathOptions={{
                  color: theme === "dark" ? "#0f1117" : "#ffffff",
                  weight: 2,
                  fillColor: NODE_COLORS[n.type as keyof typeof NODE_COLORS],
                  fillOpacity: 1,
                }}
              >
                <NodeLabel label={n.label} />
              </CircleMarker>
          ))}
        </MapContainer>}

        <div
          className={`mr-bottom${panelOpen ? " open" : ""}`}
          onMouseEnter={() => setPanelOpen(true)}
          onMouseLeave={() => setPanelOpen(false)}
        >
          <div className="mr-bottom-handle">
            <span>Routes — sorted by flood risk</span>
            <span className="mr-hint">{panelOpen ? "▾" : "▴"}</span>
          </div>
          <div className="mr-bottom-body">
            <table className="mr-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Route segment</th>
                  <th className="num">Volume (£M)</th>
                  <th className="num">Flood risk %</th>
                  <th>Risk level</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r, i) => (
                  <tr key={i} className={r.flood_risk > 0.66 ? "danger" : ""}>
                    <td>{product}</td>
                    <td>
                      {r.source?.label} → {r.target?.label}
                    </td>
                    <td className="num mono">{r.volume}</td>
                    <td className="num mono">{(r.flood_risk * 100).toFixed(0)}%</td>
                    <td style={{ color: riskColor(r.flood_risk) }}>{riskLevel(r.flood_risk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <DocumentIngestion
        open={ingestOpen}
        onClose={() => setIngestOpen(false)}
        existingNodeIds={new Set(nodes.map((n) => n.id))}
        onImport={(newNodes, newEdges) => {
          setExtraNodes((prev) => [...prev, ...newNodes]);
          setExtraEdges((prev) => [...prev, ...newEdges]);
        }}
        theme={theme}
      />

      <aside className="mr-warnings">
        <div className="mr-warnings-head">
          <div className="mr-warnings-title">
            <span className="mr-pulse" />
            <h2>Live disruption alerts</h2>
          </div>
          <p className="mr-warnings-sub">Met Office · EA · National Highways · agentic re-routing</p>
        </div>

        <div className="mr-warnings-list">
          {WARNINGS.map((w) => {
            const active = w.id === activeWarningId;
            const recs = recsByWarning[w.id] ?? [];
            const isGen = generating[w.id];
            const aboveThreshold = w.severity !== "advisory";
            return (
              <div
                key={w.id}
                className={`mr-warning${active ? " active" : ""}`}
                onClick={() => setActiveWarningId(active ? null : w.id)}
                role="button"
                tabIndex={0}
                style={{ borderLeftColor: SEVERITY_COLORS[w.severity] }}
              >
                <div className="mr-warning-top">
                  <span className="mr-warning-icon">{KIND_ICON[w.kind]}</span>
                  <span
                    className="mr-warning-sev"
                    style={{
                      background: SEVERITY_COLORS[w.severity] + "22",
                      color: SEVERITY_COLORS[w.severity],
                    }}
                  >
                    {w.severity}
                  </span>
                  <span className="mr-warning-when">{w.startsIn}</span>
                </div>
                <div className="mr-warning-title">{w.title}</div>
                <div className="mr-warning-region">{w.region}</div>
                {active && (
                  <div className="mr-warning-detail" onClick={(e) => e.stopPropagation()}>
                    <p>{w.description}</p>
                    <div className="mr-warning-meta">
                      <div><span>Issued</span><b>{w.issued}</b></div>
                      <div><span>Duration</span><b>{w.duration}</b></div>
                      <div><span>Routes hit</span><b>{w.disrupts.length}</b></div>
                    </div>
                    <div className="mr-warning-impact">
                      <span>Impact</span>
                      <p>{w.impact}</p>
                    </div>
                    <div className="mr-warning-routes">
                      {w.disrupts.map((key) => {
                        const [a, b] = key.split("->");
                        return (
                          <div key={key} className="mr-warning-route">
                            <span className="mr-warning-dot" />
                            {a} → {b}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mr-agent">
                      <div className="mr-agent-head">
                        <span className="mr-agent-badge">AGENT</span>
                        <span className="mr-agent-title">
                          {aboveThreshold
                            ? "Above re-routing threshold — operator handoff"
                            : "Below threshold — manual run available"}
                        </span>
                      </div>
                      {recs.length === 0 ? (
                        <button
                          className="mr-agent-run"
                          disabled={isGen}
                          onClick={() => generateRecommendations(w.id)}
                        >
                          {isGen ? "Querying routing engine…" : "Generate recommendations"}
                        </button>
                      ) : (
                        <div className="mr-agent-recs">
                          {recs.map((r) => {
                            const d = decisions[r.id];
                            const isRejecting = rejectingId === r.id;
                            return (
                              <div
                                key={r.id}
                                className={`mr-rec${d ? ` ${d.status}` : ""}${selectedRecId === r.id ? " selected" : ""}`}
                                onClick={() =>
                                  setSelectedRecId((cur) => (cur === r.id ? null : r.id))
                                }
                              >
                                <div className="mr-rec-head">
                                  <span className="mr-rec-route">
                                    {r.sourceLabel} → {r.targetLabel}
                                  </span>
                                  {d ? (
                                    <span className={`mr-rec-status ${d.status}`}>
                                      {d.status === "approved" ? "✓ approved" : "✕ rejected"}
                                    </span>
                                  ) : (
                                    <span className="mr-rec-status proposed">proposed</span>
                                  )}
                                </div>
                                <div className="mr-rec-stats">
                                  <div>
                                    <span>Detour via</span>
                                    <b>{r.via}</b>
                                  </div>
                                  <div>
                                    <span>Δ time</span>
                                    <b className="mono" style={{ color: "#F97316" }}>
                                      +{r.delayDeltaMin} min
                                    </b>
                                  </div>
                                  <div>
                                    <span>Δ cost</span>
                                    <b className="mono" style={{ color: "#F97316" }}>
                                      +£{r.costDeltaGBP}
                                    </b>
                                  </div>
                                </div>
                                <p className="mr-rec-rationale">{r.rationale}</p>
                                {d?.status === "approved" && (
                                  <div className="mr-rec-decision">
                                    Locked in {new Date(d.at).toLocaleTimeString()}
                                  </div>
                                )}
                                {d?.status === "rejected" && (
                                  <div className="mr-rec-decision">
                                    Dismissed {new Date(d.at).toLocaleTimeString()}
                                    {d.reason ? ` — “${d.reason}”` : ""}
                                  </div>
                                )}
                                {!d && !isRejecting && (
                                  <div className="mr-rec-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      className="mr-btn approve"
                                      onClick={() => approveRec(r)}
                                    >
                                      Approve & lock route
                                    </button>
                                    <button
                                      className="mr-btn reject"
                                      onClick={() => setRejectingId(r.id)}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                                {!d && isRejecting && (
                                  <div className="mr-rec-reject" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      autoFocus
                                      placeholder="Reason (optional) — used to tune scoring"
                                      value={rejectReason}
                                      onChange={(e) => setRejectReason(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") rejectRec(r.id, rejectReason);
                                        if (e.key === "Escape") {
                                          setRejectingId(null);
                                          setRejectReason("");
                                        }
                                      }}
                                    />
                                    <div className="mr-rec-actions">
                                      <button
                                        className="mr-btn reject"
                                        onClick={() => rejectRec(r.id, rejectReason)}
                                      >
                                        Confirm reject
                                      </button>
                                      <button
                                        className="mr-btn ghost"
                                        onClick={() => {
                                          setRejectingId(null);
                                          setRejectReason("");
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}