import { Fragment, useEffect, useMemo, useState } from "react";
import { Sun, Moon, Network, FileUp, Play } from "lucide-react";
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
  WeatherWarning,
} from "@/data/mockData";

type Product = "Insulin" | "IV Saline";

const UK_BBOX = { minLat: 49.5, maxLat: 59, minLng: -8, maxLng: 2 };
const inUK = (lat: number, lng: number) =>
  lat >= UK_BBOX.minLat && lat <= UK_BBOX.maxLat && lng >= UK_BBOX.minLng && lng <= UK_BBOX.maxLng;

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
};

const UK_ARRIVAL_PORTS: Record<string, { label: string; lat: number; lng: number }> = {
  heath: { label: "London Gateway", lat: 51.5050, lng: 0.4790 },
};

function seaCurve(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  steps = 48,
): [number, number][] {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
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
  const px = -dy / len;
  const py = dx / len;
  const off = (w.radiusKm + 25) / 111;
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

        if (!exp) {
          if (!inUK(s.lat, s.lng) || !inUK(t.lat, t.lng)) {
            setGeos((g) => ({ ...g, [key]: [[s.lat, s.lng], [t.lat, t.lng]] }));
            continue;
          }
          const coords = await fetchRoad(s, t);
          if (cancelled) return;
          if (coords) setGeos((g) => ({ ...g, [key]: coords }));
          continue;
        }

        const arrival = UK_ARRIVAL_PORTS[e.targetId] ?? { lat: t.lat, lng: t.lng };
        const truck1 = (await fetchRoad(s, exp)) ?? [[s.lat, s.lng], [exp.lat, exp.lng]];
        if (cancelled) return;
        const sea = seaCurve(exp, arrival);
        let truck2: [number, number][] = [];
        if (UK_ARRIVAL_PORTS[e.targetId]) {
          const inland = await fetchRoad(arrival, t);
          if (cancelled) return;
          truck2 = inland ?? [[arrival.lat, arrival.lng], [t.lat, t.lng]];
        }
        setGeos((g) => ({ ...g, [key]: [...truck1, ...sea, ...truck2] }));
      }
    })();
    return () => { cancelled = true; };
  }, [edges, nodeMap]);

  return geos;
}

// ── Recommendation types ─────────────────────────────────────────────────────

interface BaseRec {
  id: string;
  warningId: string;
  rationale: string;
}

interface RerouteRec extends BaseRec {
  type: "reroute";
  edgeKey: string;
  sourceLabel: string;
  targetLabel: string;
  altCoords: [number, number][];
  baselineMin: number;
  altMin: number;
  delayDeltaMin: number;
  costDeltaGBP: number;
  via: string;
}

interface AltSupplierRec extends BaseRec {
  type: "alt-supplier";
  supplierName: string;
  supplierCountry: string;
  leadTimeDays: number;
  costDeltaGBP: number;
  capacity: string;
}

interface DelayRec extends BaseRec {
  type: "delay";
  edgeKey: string;
  sourceLabel: string;
  targetLabel: string;
  recommendedDelayHours: number;
  maxSafeDelayHours: number;
  stockBufferDays: number;
  costSavingGBP: number;
}

interface PostponeRec extends BaseRec {
  type: "postpone";
  verdict: "safe" | "risky" | "unsafe";
  verdictLabel: string;
  clinicalRisk: string;
  hospitalStocks: { name: string; stockDays: number; urgency: "critical" | "high" | "medium" | "low" }[];
  holdWindowHours: number;
  triggerCondition: string;
}

type Recommendation = RerouteRec | AltSupplierRec | DelayRec | PostponeRec;

// ── Static data ───────────────────────────────────────────────────────────────

const ALT_SUPPLIERS: Record<string, { name: string; country: string; leadTimeDays: number; costDeltaGBP: number; capacity: string }[]> = {
  Insulin: [
    { name: "Novo Nordisk Chartres",  country: "France",   leadTimeDays: 3, costDeltaGBP: 1200, capacity: "120% demand coverage" },
    { name: "Eli Lilly Cork",         country: "Ireland",  leadTimeDays: 2, costDeltaGBP: 800,  capacity: "85% demand coverage" },
    { name: "Sanofi Frankfurt",       country: "Germany",  leadTimeDays: 4, costDeltaGBP: 950,  capacity: "Full coverage" },
    { name: "Wockhardt Wrexham",      country: "UK",       leadTimeDays: 1, costDeltaGBP: 1800, capacity: "60% demand coverage" },
  ],
  "IV Saline": [
    { name: "B. Braun Melsungen",          country: "Germany", leadTimeDays: 5, costDeltaGBP: 2200, capacity: "90% demand coverage" },
    { name: "Fresenius Kabi Graz",         country: "Austria", leadTimeDays: 6, costDeltaGBP: 1900, capacity: "75% demand coverage" },
    { name: "Baxter Castlebar",            country: "Ireland", leadTimeDays: 3, costDeltaGBP: 1400, capacity: "Full coverage" },
    { name: "ICU Medical San Clemente",    country: "USA",     leadTimeDays: 9, costDeltaGBP: 3500, capacity: "110% demand coverage" },
  ],
};

// Per-hospital current stock levels (days on hand) and clinical urgency
const HOSPITAL_STOCKS: Record<string, { label: string; stockDays: number; urgency: "critical" | "high" | "medium" | "low"; minSafeDays: number }> = {
  rlh: { label: "Royal London",    stockDays: 4.2, urgency: "critical", minSafeDays: 3 },
  mri: { label: "Manchester RI",   stockDays: 7.1, urgency: "high",     minSafeDays: 2 },
  lgi: { label: "Leeds General",   stockDays: 5.8, urgency: "high",     minSafeDays: 2 },
  bri: { label: "Bristol Royal",   stockDays: 9.3, urgency: "medium",   minSafeDays: 2 },
};

// Which hospitals are downstream of each disrupted edge
const EDGE_TO_HOSPITALS: Record<string, string[]> = {
  "heath->dav":   ["rlh", "mri", "lgi", "bri"],
  "felix->dav":   ["rlh", "mri", "lgi", "bri"],
  "dav->lon_w":   ["rlh"],
  "dav->man_w":   ["mri"],
  "dav->leeds_w": ["lgi"],
  "dav->bris_w":  ["bri"],
  "lon_w->rlh":   ["rlh"],
  "man_w->mri":   ["mri"],
  "leeds_w->lgi": ["lgi"],
  "bris_w->bri":  ["bri"],
};

// Pool of realistic EA-shaped simulated flood events targeting actual route edges
const SIMULATED_EVENTS: Omit<WeatherWarning, "id" | "issued" | "startsIn">[] = [
  {
    kind: "flood",
    severity: "severe",
    title: "Severe flood warning — River Severn, Worcestershire",
    region: "West Midlands & Gloucestershire",
    lat: 52.19,
    lng: -2.22,
    radiusKm: 48,
    duration: "48 h",
    description:
      "Prolonged rainfall over the Welsh uplands has caused the River Severn to breach defences at Upton upon Severn and Tewkesbury. M5 J7–J9 impassable to HGV traffic; A38 and A4019 under water. EA gauge data confirms river 0.8 m above alert threshold.",
    disrupts: ["dav->bris_w", "bris_w->bri"],
    impact: "Bristol-bound NHS trunk road from Daventry cut off. Royal Bristol Infirmary last-mile delivery at risk.",
  },
  {
    kind: "flood",
    severity: "warning",
    title: "Flood warning — River Ouse, York & East Riding",
    region: "Yorkshire & Humber",
    lat: 53.96,
    lng: -1.08,
    radiusKm: 40,
    duration: "30 h",
    description:
      "Snowmelt from the North York Moors combined with heavy rainfall has raised the Ouse above warning level at York. A64 and A19 interchange flooded. M62 diversion expected to add 60–80 min to northbound HGV journeys. EA monitoring stations recording rising trend.",
    disrupts: ["dav->leeds_w", "leeds_w->lgi"],
    impact: "Leeds distribution corridor congested. Leeds General Infirmary replenishment delayed 2–4 h.",
  },
  {
    kind: "flood",
    severity: "warning",
    title: "Flood warning — River Nene, Peterborough & Fenland",
    region: "Anglian & East Midlands",
    lat: 52.57,
    lng: -0.24,
    radiusKm: 38,
    duration: "24 h",
    description:
      "Sustained rainfall across Northamptonshire has overwhelmed drainage on the Nene valley. A14 eastbound near Peterborough subject to surface water flooding. Port of Felixstowe access road risk elevated. EA gauge at Orton shows level rising toward flood alert threshold.",
    disrupts: ["felix->dav", "dav->lon_w"],
    impact: "Felixstowe-to-Daventry IV Saline trunk disrupted. London last-mile supply at risk of 3–5 h delay.",
  },
];

function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

interface Decision {
  status: "approved" | "rejected";
  at: string;
  reason?: string;
}

function approxPlaceName(p: LL): string {
  const places = [
    { name: "Birmingham", lat: 52.48, lng: -1.9 },
    { name: "Oxford",     lat: 51.75, lng: -1.26 },
    { name: "Cambridge",  lat: 52.2,  lng: 0.12 },
    { name: "Reading",    lat: 51.45, lng: -0.97 },
    { name: "Northampton",lat: 52.24, lng: -0.9 },
    { name: "Sheffield",  lat: 53.38, lng: -1.47 },
    { name: "Nottingham", lat: 52.95, lng: -1.15 },
    { name: "Stoke",      lat: 53.0,  lng: -2.18 },
    { name: "Carlisle",   lat: 54.89, lng: -2.94 },
    { name: "Exeter",     lat: 50.72, lng: -3.53 },
    { name: "Cardiff",    lat: 51.48, lng: -3.18 },
    { name: "Norwich",    lat: 52.63, lng: 1.3 },
    { name: "Peterborough",lat: 52.57,lng: -0.24 },
    { name: "Coventry",   lat: 52.41, lng: -1.51 },
  ];
  let best = places[0];
  let bd = Infinity;
  for (const pl of places) {
    const d = Math.hypot(pl.lat - p.lat, pl.lng - p.lng);
    if (d < bd) { bd = d; best = pl; }
  }
  return best.name;
}

function NodeLabel({ label, sub }: { label: string; sub?: string }) {
  return (
    <LTooltip permanent direction="top" offset={[0, -8]} className="mr-node-label">
      {label}
      {sub ? <span className="mr-node-sub"> · {sub}</span> : null}
    </LTooltip>
  );
}

// GP insulin volume → marker radius. Range derived from current GP set (~16k–30k units).
function gpRadius(volume: number) {
  const min = 15000;
  const max = 32000;
  const t = Math.max(0, Math.min(1, (volume - min) / (max - min)));
  return 8 + t * 12; // 8–20 px
}

// Hospital saline volume → marker radius. Range derived from current trust set (~12k–193k DDDs/7yr).
function hospitalSalineRadius(volume: number) {
  const min = 12000;
  const max = 193000;
  const t = Math.max(0, Math.min(1, (volume - min) / (max - min)));
  return 8 + t * 14; // 8–22 px
}

export default function MediRouteDashboard() {
  const [product, setProduct] = useState<Product>("Insulin");
  const [graphMode, setGraphMode] = useState<"2d" | "graph">("2d");
  const [viewMode, setViewMode] = useState<"international" | "domestic">("international");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
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
  // Live warnings — start from static set, grow when events are simulated
  const [warnings, setWarnings] = useState<WeatherWarning[]>(WARNINGS);
  const [simulatingEvent, setSimulatingEvent] = useState(false);

  useEffect(() => {
    localStorage.setItem("mr-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const activeWarning = useMemo(
    () => warnings.find((w) => w.id === activeWarningId) ?? null,
    [activeWarningId, warnings],
  );
  const disruptedSet = useMemo(
    () => new Set(activeWarning?.disrupts ?? []),
    [activeWarning],
  );

  const nodes = useMemo(() => [...getNodes(product), ...extraNodes], [product, extraNodes]);
  const allEdges = useMemo(() => [...getEdges(product), ...extraEdges], [product, extraEdges]);
  const nodeMap = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  const isInternationalEdge = (e: { sourceId: string }) => !!EXPORT_PORTS[e.sourceId];
  const edges = useMemo(
    () => (viewMode === "international" ? allEdges : allEdges.filter((e) => !isInternationalEdge(e))),
    [allEdges, viewMode],
  );
  const roadGeos = useRoadGeometries(edges, nodeMap);

  const approvedAltGeo = useMemo(() => {
    const out: Record<string, [number, number][]> = {};
    for (const recs of Object.values(recsByWarning)) {
      for (const r of recs) {
        const d = decisions[r.id];
        if (d?.status === "approved" && r.type === "reroute") out[r.edgeKey] = r.altCoords;
      }
    }
    return out;
  }, [recsByWarning, decisions]);

  const previewRec = useMemo((): RerouteRec | null => {
    if (!selectedRecId) return null;
    for (const recs of Object.values(recsByWarning)) {
      const r = recs.find((x) => x.id === selectedRecId);
      if (r && r.type === "reroute") return r;
    }
    return null;
  }, [selectedRecId, recsByWarning]);

  useEffect(() => { setSelectedRecId(null); }, [activeWarningId]);

  // ── Simulate a new EA flood event ─────────────────────────────────────────

  async function simulateFloodEvent() {
    setSimulatingEvent(true);

    // Pick a template from the pool, cycling through them
    const usedSimulated = warnings.filter(w => w.id.startsWith("sim-")).length;
    const template = SIMULATED_EVENTS[usedSimulated % SIMULATED_EVENTS.length];

    let liveStationNote = "";
    try {
      // Real call to EA API — fetch nearby monitoring stations
      const stRes = await fetch(
        `https://environment.data.gov.uk/flood-monitoring/id/stations?parameter=level&lat=${template.lat}&long=${template.lng}&dist=25&_limit=3`,
      );
      if (stRes.ok) {
        const stData = await stRes.json();
        const stations: { "@id": string; label: string; riverName?: string; measures?: { unitName: string }[] }[] = stData?.items ?? [];
        if (stations.length > 0) {
          const st = stations[0];
          // Fetch latest reading for that station
          const rRes = await fetch(`${st["@id"]}/readings?_limit=1&_sorted`);
          if (rRes.ok) {
            const rData = await rRes.json();
            const reading: { value: number } | undefined = rData?.items?.[0];
            if (reading) {
              const unit = st.measures?.[0]?.unitName ?? "m";
              liveStationNote = ` Live EA gauge — ${st.label}${st.riverName ? ` (${st.riverName})` : ""}: ${reading.value.toFixed(2)} ${unit} at ${new Date().toLocaleTimeString("en-GB")}.`;
            }
          }
        }
      }
    } catch {
      // silently fall back — no live data available
    }

    const newWarning: WeatherWarning = {
      ...template,
      id: `sim-${Date.now()}`,
      issued: `EA Flood Monitoring API · ${new Date().toLocaleTimeString("en-GB")} UTC`,
      startsIn: "incoming now",
      description: template.description + liveStationNote,
    };

    setWarnings((prev) => [newWarning, ...prev]);
    setActiveWarningId(newWarning.id);
    setSimulatingEvent(false);
  }

  // ── Generate recommendations ───────────────────────────────────────────────

  async function generateRecommendations(warningId: string) {
    const w = warnings.find((x) => x.id === warningId);
    if (!w) return;
    setGenerating((g) => ({ ...g, [warningId]: true }));
    const out: Recommendation[] = [];

    const fallbackNodes = Object.fromEntries(
      [...getNodes("Insulin"), ...getNodes("IV Saline")].map((n) => [n.id, n]),
    );

    const now = new Date();
    const cutoffHour = (now.getHours() + 2) % 24;
    const cutoffTime = `${String(cutoffHour).padStart(2, "0")}:00`;

    // ── Reroute recommendations ──────────────────────────────────────────────
    for (const edgeKey of w.disrupts) {
      const [sId, tId] = edgeKey.split("->");
      const src = nodeMap[sId] ?? fallbackNodes[sId];
      const tgt = nodeMap[tId] ?? fallbackNodes[tId];
      if (!src || !tgt) continue;

      const baseline = await fetchOsrmRoute([src, tgt]);
      const wp = detourWaypoint(src, tgt, w);
      const alt = await fetchOsrmRoute([src, wp, tgt]);

      const baselineMin = baseline ? Math.round(baseline.durationSec / 60) : 120;
      const altMin = alt ? Math.round(alt.durationSec / 60) : Math.round(baselineMin * 1.35);
      const delayDeltaMin = Math.max(5, altMin - baselineMin);

      const distanceKmDelta = alt && baseline
        ? Math.max(0, (alt.distanceM - baseline.distanceM) / 1000)
        : delayDeltaMin * 1.1;
      const costDeltaGBP = Math.round(delayDeltaMin * 1.1 + distanceKmDelta * 0.42);

      const altCoords: [number, number][] = alt?.coords ?? [
        [src.lat, src.lng], [wp.lat, wp.lng], [tgt.lat, tgt.lng],
      ];

      const via = approxPlaceName(wp);
      out.push({
        id: `${w.id}::${edgeKey}`,
        warningId: w.id,
        type: "reroute",
        edgeKey,
        sourceLabel: src.label,
        targetLabel: tgt.label,
        altCoords,
        baselineMin,
        altMin,
        delayDeltaMin,
        costDeltaGBP,
        via,
        rationale:
          `Bypass confirmed via ${via}, avoiding the active ${w.kind} geofence (${w.radiusKm} km radius, ${w.severity}). ` +
          `OSRM routing confirms road access — no weight restrictions flagged on this detour. ` +
          `Cost uplift: £${costDeltaGBP} (${delayDeltaMin} min HGV time + ${Math.round(distanceKmDelta)} km additional diesel). ` +
          `Temperature-controlled cargo integrity maintained — route stays within NHS cold chain SLA of 4 h transit. ` +
          `Notify receiving warehouse of revised ETA before dispatch.`,
      });
    }

    // ── Alternative supplier recommendations ─────────────────────────────────
    const seed = w.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const suppliers = ALT_SUPPLIERS[product] ?? ALT_SUPPLIERS["Insulin"];
    const si1 = Math.floor(seededRand(seed) * suppliers.length);
    const s1 = suppliers[si1];
    const remaining = suppliers.filter((_, i) => i !== si1);
    const s2 = remaining[Math.floor(seededRand(seed + 7) * remaining.length)];
    [s1, s2].forEach((sup, i) => {
      out.push({
        id: `${w.id}::alt-supplier-${i}`,
        warningId: w.id,
        type: "alt-supplier",
        supplierName: sup.name,
        supplierCountry: sup.country,
        leadTimeDays: sup.leadTimeDays,
        costDeltaGBP: sup.costDeltaGBP,
        capacity: sup.capacity,
        rationale:
          `${sup.name} (${sup.country}) holds an existing NHS framework contract — no emergency procurement required. ` +
          `MHRA-registered importer, no open batch recalls. ${sup.capacity} across current ${product} demand. ` +
          `Fully avoids the ${w.kind}-affected corridor. ` +
          `Approve before ${cutoffTime} to hit the next scheduled delivery window. ` +
          `Δ cost £${sup.costDeltaGBP.toLocaleString()} reflects expedited freight premium, within NHS variance threshold.`,
      });
    });

    // ── Delay / hold recommendation ───────────────────────────────────────────
    const delayOptions = [12, 24, 36, 48];
    const recommendedDelayHours = delayOptions[Math.floor(seededRand(seed + 1) * delayOptions.length)];
    const maxSafeDelayHours = recommendedDelayHours + [12, 24, 36][Math.floor(seededRand(seed + 2) * 3)];
    const stockBufferDays = 3 + Math.floor(seededRand(seed + 3) * 6);
    const costSavingGBP = Math.round(800 + seededRand(seed + 4) * 2400);
    const clearHour = (now.getHours() + recommendedDelayHours) % 24;
    const clearTime = `${String(clearHour).padStart(2, "0")}:00`;
    const firstEdge = w.disrupts[0];
    const [fsId, ftId] = firstEdge.split("->");
    const fSrc = nodeMap[fsId] ?? fallbackNodes[fsId];
    const fTgt = nodeMap[ftId] ?? fallbackNodes[ftId];
    out.push({
      id: `${w.id}::delay`,
      warningId: w.id,
      type: "delay",
      edgeKey: firstEdge,
      sourceLabel: fSrc?.label ?? fsId,
      targetLabel: fTgt?.label ?? ftId,
      recommendedDelayHours,
      maxSafeDelayHours,
      stockBufferDays,
      costSavingGBP,
      rationale:
        `Network stock buffer of ${stockBufferDays} days across downstream hospitals allows this shipment to hold up to ${maxSafeDelayHours} h without breaching reorder thresholds. ` +
        `Waiting ${recommendedDelayHours} h avoids peak ${w.kind} conditions — EA forecast shows improvement by ~${clearTime}. ` +
        `Estimated saving £${costSavingGBP.toLocaleString()} vs immediate emergency reroute. ` +
        `Set auto-dispatch trigger: if conditions have not improved by ${clearTime}, escalate to reroute option automatically.`,
    });

    // ── Postpone / operational hold assessment ────────────────────────────────
    const affectedHospitalIds = new Set<string>();
    for (const edgeKey of w.disrupts) {
      (EDGE_TO_HOSPITALS[edgeKey] ?? []).forEach((h) => affectedHospitalIds.add(h));
    }
    const hospitalStocks = Array.from(affectedHospitalIds)
      .map((hId) => HOSPITAL_STOCKS[hId])
      .filter(Boolean);

    const criticalStocks = hospitalStocks.filter((h) => h.stockDays < 5);
    const verdict: PostponeRec["verdict"] =
      criticalStocks.some((h) => h.stockDays < h.minSafeDays) ? "unsafe" :
      criticalStocks.length > 0 ? "risky" : "safe";

    const verdictLabel =
      verdict === "unsafe" ? "NOT SAFE — Act immediately" :
      verdict === "risky"  ? "RISKY — Monitor closely" :
                             "SAFE — Window available";

    const minStock = hospitalStocks.length > 0
      ? Math.min(...hospitalStocks.map((h) => h.stockDays))
      : stockBufferDays;
    const holdWindowHours = Math.max(0, Math.floor((minStock - 2) * 24));

    const mostCritical = hospitalStocks.sort((a, b) => a.stockDays - b.stockDays)[0];

    out.push({
      id: `${w.id}::postpone`,
      warningId: w.id,
      type: "postpone",
      verdict,
      verdictLabel,
      clinicalRisk:
        verdict === "unsafe"
          ? `Critical — ${mostCritical?.label ?? "affected hospital"} below minimum safe stock threshold`
          : verdict === "risky"
          ? `Elevated — ${criticalStocks.length} hospital(s) under 5-day reorder trigger`
          : "Managed — all sites exceed minimum stock threshold",
      hospitalStocks: hospitalStocks.map((h) => ({
        name: h.label,
        stockDays: h.stockDays,
        urgency: h.urgency,
      })),
      holdWindowHours,
      triggerCondition: `Auto-escalate if stock drops below ${verdict === "unsafe" ? mostCritical?.minSafeDays ?? 2 : 5} days at any site`,
      rationale:
        verdict === "unsafe"
          ? `${mostCritical?.label ?? "A downstream hospital"} holds only ${mostCritical?.stockDays.toFixed(1)} days of ${product} — below the ${mostCritical?.minSafeDays ?? 3}-day clinical threshold for this product. Postponing operations is NOT recommended. Escalate to emergency procurement or expedited reroute within 6 h. Flag to NHS Supply Chain and regional pharmacy teams immediately.`
          : verdict === "risky"
          ? `${criticalStocks.length} hospital(s) have stock below the 5-day reorder trigger. A hold window of up to ${holdWindowHours} h is technically available but carries elevated clinical risk if the ${w.kind} event extends beyond the forecast ${w.duration} window. Recommend activating the hold with a 4-hour review cadence and pre-authorising the reroute as contingency.`
          : `All downstream hospitals hold >${Math.floor(minStock - 0.1)} days of ${product}, above the minimum ${2}-day operational threshold. Safe to postpone non-urgent shipments for up to ${holdWindowHours} h while ${w.kind} conditions improve. Revisit at the ${Math.round(holdWindowHours / 2)}-hour mark and confirm stock levels have not deteriorated.`,
    });

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
      console.info("[MediRoute] rejection logged", { recId, reason, at: new Date().toISOString() });
    }
    setRejectingId(null);
    setRejectReason("");
  }

  const tableRows = useMemo(
    () =>
      [...edges]
        .map((e) => ({ ...e, source: nodeMap[e.sourceId], target: nodeMap[e.targetId] }))
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
            <div className="mr-section-title">View</div>
            <div className="mr-pills">
              {(["international", "domestic"] as const).map((m) => (
                <button
                  key={m}
                  className={`mr-pill${viewMode === m ? " active" : ""}`}
                  onClick={() => setViewMode(m)}
                >
                  {m === "international" ? "International" : "Domestic"}
                </button>
              ))}
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
        {graphMode === "2d" && (
          <MapContainer
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
              const positions: [number, number][] = road ?? [[s.lat, s.lng], [t.lat, t.lng]];
              const isDisrupted = disruptedSet.has(key);
              const altPositions = approvedAltGeo[key];
              const isPreviewing = previewRec?.edgeKey === key;
              const dim = activeWarning && !isDisrupted && !isPreviewing;
              const previewOpacity = isPreviewing ? 1 : altPositions ? 0.18 : dim ? 0.18 : 0.9;
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
                    <LTooltip sticky direction="top" offset={[0, -4]} className="mr-tooltip">
                      <div className="mr-tt">
                        <div className="mr-tt-row"><span>Route</span><b>{s.label} → {t.label}</b></div>
                        <div className="mr-tt-row"><span>Volume</span><b className="mono">£{e.volume}M/yr</b></div>
                        <div className="mr-tt-row"><span>Flood risk</span><b className="mono">{(e.flood_risk * 100).toFixed(0)}%</b></div>
                        <div className="mr-tt-row"><span>Risk level</span><b style={{ color: riskColor(e.flood_risk) }}>{riskLevel(e.flood_risk)}</b></div>
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
                          <div className="mr-tt-row"><span>Status</span><b style={{ color: "#3B82F6" }}>Proposed reroute</b></div>
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
                          <div className="mr-tt-row"><span>Status</span><b style={{ color: "#22C55E" }}>Agent reroute · approved</b></div>
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

          {nodes
            .filter((n) => {
              if (viewMode === "international") {
                if (n.type === "gp_practice" || n.type === "wholesaler") return false;
                if (n.type === "hospital" && (n as { salineVolume?: number }).salineVolume != null) return false;
              }
              return true;
            })
            .map((n) => {
            const isGp = n.type === "gp_practice";
            const insulinVol = (n as { insulinVolume?: number }).insulinVolume;
            const salineVol = (n as { salineVolume?: number }).salineVolume;
            const trust = (n as { trust?: string }).trust;
            const isSizedHospital = n.type === "hospital" && salineVol != null;
            const radius = isGp && insulinVol
              ? gpRadius(insulinVol)
              : isSizedHospital
                ? hospitalSalineRadius(salineVol!)
                : 7;
            const sub = isGp && insulinVol
              ? `${insulinVol.toLocaleString()} u/yr`
              : undefined;
            return (
              <CircleMarker
                key={n.id}
                center={[n.lat, n.lng]}
                radius={radius}
                pathOptions={{
                  color: theme === "dark" ? "#0f1117" : "#ffffff",
                  weight: 2,
                  fillColor: NODE_COLORS[n.type as keyof typeof NODE_COLORS],
                  fillOpacity: isGp || isSizedHospital ? 0.85 : 1,
                }}
                eventHandlers={isSizedHospital ? {
                  mouseover: () => setHoveredNodeId(n.id),
                  mouseout: () => setHoveredNodeId((prev) => (prev === n.id ? null : prev)),
                } : undefined}
              >
                {isSizedHospital ? (
                  <LTooltip permanent direction="top" offset={[0, -8]} className="mr-node-label">
                    <div>{n.label}</div>
                    {hoveredNodeId === n.id && (
                      <div className="mr-node-detail">
                        {trust && <div className="mr-node-detail-row">{trust}</div>}
                        <div className="mr-node-detail-row mono">
                          {salineVol!.toLocaleString()} DDDs / 7yr
                        </div>
                      </div>
                    )}
                  </LTooltip>
                ) : (
                  <NodeLabel label={n.label} sub={sub} />
                )}
              </CircleMarker>
            );
          })}
          </MapContainer>
        )}

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
                    <td>{r.source?.label} → {r.target?.label}</td>
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
          {/* Simulate incoming EA flood event */}
          <button
            className="mr-simulate-btn"
            onClick={simulateFloodEvent}
            disabled={simulatingEvent}
            title="Simulate incoming EA flood warning"
          >
            {simulatingEvent ? (
              <>
                <span className="mr-sim-spinner" />
                Fetching EA data…
              </>
            ) : (
              <>
                <Play size={11} />
                Run
              </>
            )}
          </button>
        </div>

        <div className="mr-warnings-list">
          {warnings.map((w) => {
            const active = w.id === activeWarningId;
            const recs = recsByWarning[w.id] ?? [];
            const isGen = generating[w.id];
            const aboveThreshold = w.severity !== "advisory";
            const isSimulated = w.id.startsWith("sim-");
            return (
              <div
                key={w.id}
                className={`mr-warning${active ? " active" : ""}${isSimulated ? " simulated" : ""}`}
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
                  {isSimulated && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#3B82F6", marginLeft: "auto", flexShrink: 0 }}>
                      EA LIVE
                    </span>
                  )}
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
                        const srcNode = nodeMap[a] ?? getNodes("Insulin").find(n => n.id === a) ?? getNodes("IV Saline").find(n => n.id === a);
                        const tgtNode = nodeMap[b] ?? getNodes("Insulin").find(n => n.id === b) ?? getNodes("IV Saline").find(n => n.id === b);
                        return (
                          <div key={key} className="mr-warning-route">
                            <span className="mr-warning-dot" />
                            {srcNode?.label ?? a} → {tgtNode?.label ?? b}
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
                            const TYPE_META = {
                              reroute:         { label: "REROUTE",      color: "#F97316" },
                              "alt-supplier":  { label: "ALT SUPPLIER", color: "#8B5CF6" },
                              delay:           { label: "DELAY",        color: "#14B8A6" },
                              postpone:        { label: "POSTPONE?",    color: "#EF4444" },
                            };
                            const { label: typeLabel, color: typeColor } = TYPE_META[r.type];
                            const approveLabel =
                              r.type === "reroute"       ? "Approve & lock route"       :
                              r.type === "alt-supplier"  ? "Approve & switch supplier"  :
                              r.type === "postpone"      ? "Approve & hold operations"  :
                                                           "Approve & hold shipment";
                            const cardTitle =
                              r.type === "alt-supplier" ? r.supplierName :
                              r.type === "postpone"     ? "Operational Hold Assessment" :
                                                          `${r.sourceLabel} → ${r.targetLabel}`;
                            return (
                              <div
                                key={r.id}
                                className={`mr-rec${d ? ` ${d.status}` : ""}${selectedRecId === r.id ? " selected" : ""}`}
                                onClick={() =>
                                  r.type === "reroute"
                                    ? setSelectedRecId((cur) => (cur === r.id ? null : r.id))
                                    : undefined
                                }
                              >
                                <div className="mr-rec-head">
                                  <span className="mr-rec-route">{cardTitle}</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, background: typeColor + "22", color: typeColor, padding: "2px 5px", borderRadius: 4, flexShrink: 0 }}>
                                    {typeLabel}
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
                                  {r.type === "reroute" && (
                                    <>
                                      <div><span>Detour via</span><b>{r.via}</b></div>
                                      <div><span>Δ time</span><b className="mono" style={{ color: "#F97316" }}>+{r.delayDeltaMin} min</b></div>
                                      <div><span>Δ cost</span><b className="mono" style={{ color: "#F97316" }}>+£{r.costDeltaGBP}</b></div>
                                      <div><span>Cold chain</span><b style={{ color: "#22C55E" }}>Within SLA</b></div>
                                    </>
                                  )}
                                  {r.type === "alt-supplier" && (
                                    <>
                                      <div><span>Country</span><b>{r.supplierCountry}</b></div>
                                      <div><span>Lead time</span><b className="mono" style={{ color: "#8B5CF6" }}>{r.leadTimeDays} days</b></div>
                                      <div><span>Capacity</span><b>{r.capacity}</b></div>
                                      <div><span>Δ cost</span><b className="mono" style={{ color: "#F97316" }}>+£{r.costDeltaGBP.toLocaleString()}</b></div>
                                      <div><span>Contract</span><b style={{ color: "#22C55E" }}>NHS framework</b></div>
                                    </>
                                  )}
                                  {r.type === "delay" && (
                                    <>
                                      <div><span>Hold for</span><b className="mono" style={{ color: "#14B8A6" }}>{r.recommendedDelayHours} h</b></div>
                                      <div><span>Max safe</span><b className="mono">{r.maxSafeDelayHours} h</b></div>
                                      <div><span>Stock buffer</span><b className="mono">{r.stockBufferDays} days</b></div>
                                      <div><span>Est. saving</span><b className="mono" style={{ color: "#22C55E" }}>£{r.costSavingGBP.toLocaleString()}</b></div>
                                    </>
                                  )}
                                  {r.type === "postpone" && (
                                    <>
                                      <div>
                                        <span>Verdict</span>
                                        <b style={{
                                          color: r.verdict === "safe" ? "#22C55E" : r.verdict === "risky" ? "#F97316" : "#EF4444",
                                          fontWeight: 800,
                                        }}>
                                          {r.verdictLabel}
                                        </b>
                                      </div>
                                      <div><span>Hold window</span><b className="mono">{r.holdWindowHours} h max</b></div>
                                      <div><span>Clinical risk</span><b>{r.clinicalRisk}</b></div>
                                      {r.hospitalStocks.map((h) => (
                                        <div key={h.name}>
                                          <span>{h.name}</span>
                                          <b
                                            className="mono"
                                            style={{
                                              color: h.stockDays < 3 ? "#EF4444" : h.stockDays < 5 ? "#F97316" : "#22C55E",
                                            }}
                                          >
                                            {h.stockDays.toFixed(1)} d stock
                                          </b>
                                        </div>
                                      ))}
                                      <div><span>Auto-trigger</span><b style={{ fontSize: 10 }}>{r.triggerCondition}</b></div>
                                    </>
                                  )}
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
                                    {d.reason ? ` — "${d.reason}"` : ""}
                                  </div>
                                )}
                                {!d && !isRejecting && (
                                  <div className="mr-rec-actions" onClick={(e) => e.stopPropagation()}>
                                    <button className="mr-btn approve" onClick={() => approveRec(r)}>
                                      {approveLabel}
                                    </button>
                                    <button className="mr-btn reject" onClick={() => setRejectingId(r.id)}>
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
                                      <button className="mr-btn reject" onClick={() => rejectRec(r.id, rejectReason)}>
                                        Confirm reject
                                      </button>
                                      <button
                                        className="mr-btn ghost"
                                        onClick={() => { setRejectingId(null); setRejectReason(""); }}
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
