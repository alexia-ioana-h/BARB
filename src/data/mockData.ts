export const PRODUCTS = ["Insulin", "IV Saline"];

export const NODE_COLORS = {
  manufacturer: "#3B82F6",
  port: "#8B5CF6",
  national_wh: "#F97316",
  regional_wh: "#F59E0B",
  hospital: "#14B8A6",
};

export const NODE_TYPE_LABELS = {
  manufacturer: "Manufacturer",
  port: "Port",
  national_wh: "National warehouse",
  regional_wh: "Regional warehouse",
  hospital: "Hospital",
};

const baseNodes = [
  { id: "glooko", label: "Glooko HQ", type: "manufacturer", lat: 37.4419, lng: -122.143 },
  { id: "abbott", label: "Abbott Kilkenny Plant", type: "manufacturer", lat: 52.6541, lng: -7.2448 },
  { id: "menarini", label: "Menarini Florence", type: "manufacturer", lat: 43.7696, lng: 11.2558 },
  { id: "insulet", label: "Insulet HQ", type: "manufacturer", lat: 42.4851, lng: -71.4328 },
  { id: "tandem", label: "Tandem San Diego", type: "manufacturer", lat: 32.8886, lng: -117.1714 },
  { id: "sooil", label: "SOOIL HQ", type: "manufacturer", lat: 37.5665, lng: 126.978 },
  { id: "dexcom", label: "Dexcom Athenry Plant", type: "manufacturer", lat: 53.4225, lng: -8.745 },
  { id: "medtronic", label: "Medtronic Galway", type: "manufacturer", lat: 53.2707, lng: -9.0568 },
  { id: "ypsomed", label: "Ypsomed Burgdorf", type: "manufacturer", lat: 47.0594, lng: 7.6282 },
  { id: "airliquide", label: "Air Liquide Coleshill", type: "manufacturer", lat: 52.5159, lng: -1.7069 },
  { id: "roche", label: "Roche DC Indianapolis", type: "manufacturer", lat: 39.7684, lng: -86.1581 },
  { id: "heath", label: "Heathrow", type: "port", lat: 51.47, lng: -0.45 },
  { id: "felix", label: "Felixstowe", type: "port", lat: 51.96, lng: 1.35 },
  { id: "dav", label: "NHS Daventry", type: "national_wh", lat: 52.26, lng: -1.14 },
  { id: "leeds_w", label: "Leeds WH", type: "regional_wh", lat: 53.8, lng: -1.55 },
  { id: "bris_w", label: "Bristol WH", type: "regional_wh", lat: 51.45, lng: -2.59 },
  { id: "man_w", label: "Manchester WH", type: "regional_wh", lat: 53.48, lng: -2.24 },
  { id: "lon_w", label: "London WH", type: "regional_wh", lat: 51.52, lng: -0.08 },
  { id: "rlh", label: "Royal London", type: "hospital", lat: 51.52, lng: -0.06 },
  { id: "mri", label: "Manchester RI", type: "hospital", lat: 53.46, lng: -2.23 },
  { id: "lgi", label: "Leeds General", type: "hospital", lat: 53.8, lng: -1.56 },
  { id: "bri", label: "Bristol Royal", type: "hospital", lat: 51.46, lng: -2.6 },
];

const salineExtraNodes: typeof baseNodes = [];

const insulinEdges = [
  { sourceId: "glooko", targetId: "heath", volume: 60, flood_risk: 0.1 },
  { sourceId: "abbott", targetId: "heath", volume: 55, flood_risk: 0.15 },
  { sourceId: "menarini", targetId: "heath", volume: 45, flood_risk: 0.1 },
  { sourceId: "insulet", targetId: "heath", volume: 50, flood_risk: 0.1 },
  { sourceId: "tandem", targetId: "heath", volume: 45, flood_risk: 0.15 },
  { sourceId: "sooil", targetId: "heath", volume: 40, flood_risk: 0.1 },
  { sourceId: "dexcom", targetId: "heath", volume: 25, flood_risk: 0.1 },
  { sourceId: "medtronic", targetId: "heath", volume: 25, flood_risk: 0.15 },
  { sourceId: "heath", targetId: "dav", volume: 340, flood_risk: 0.25 },
  { sourceId: "felix", targetId: "dav", volume: 60, flood_risk: 0.55 },
  { sourceId: "dav", targetId: "leeds_w", volume: 85, flood_risk: 0.3 },
  { sourceId: "dav", targetId: "bris_w", volume: 75, flood_risk: 0.2 },
  { sourceId: "dav", targetId: "man_w", volume: 90, flood_risk: 0.15 },
  { sourceId: "dav", targetId: "lon_w", volume: 95, flood_risk: 0.4 },
  { sourceId: "leeds_w", targetId: "lgi", volume: 85, flood_risk: 0.3 },
  { sourceId: "bris_w", targetId: "bri", volume: 75, flood_risk: 0.2 },
  { sourceId: "man_w", targetId: "mri", volume: 90, flood_risk: 0.15 },
  { sourceId: "lon_w", targetId: "rlh", volume: 95, flood_risk: 0.45 },
];

const salineEdges = [
  { sourceId: "ypsomed", targetId: "felix", volume: 75, flood_risk: 0.55 },
  { sourceId: "airliquide", targetId: "felix", volume: 70, flood_risk: 0.55 },
  { sourceId: "roche", targetId: "felix", volume: 60, flood_risk: 0.55 },
  { sourceId: "felix", targetId: "dav", volume: 200, flood_risk: 0.55 },
  { sourceId: "dav", targetId: "leeds_w", volume: 50, flood_risk: 0.3 },
  { sourceId: "dav", targetId: "bris_w", volume: 45, flood_risk: 0.2 },
  { sourceId: "dav", targetId: "man_w", volume: 55, flood_risk: 0.15 },
  { sourceId: "dav", targetId: "lon_w", volume: 55, flood_risk: 0.4 },
  { sourceId: "leeds_w", targetId: "lgi", volume: 50, flood_risk: 0.3 },
  { sourceId: "bris_w", targetId: "bri", volume: 45, flood_risk: 0.2 },
  { sourceId: "man_w", targetId: "mri", volume: 55, flood_risk: 0.15 },
  { sourceId: "lon_w", targetId: "rlh", volume: 55, flood_risk: 0.45 },
];

export function getNodes(product: string) {
  return product === "IV Saline" ? [...baseNodes, ...salineExtraNodes] : baseNodes;
}

export function getEdges(product: string) {
  return product === "IV Saline" ? salineEdges : insulinEdges;
}

export const VOLUME_RANGE = { min: 70, max: 340 };

// Flood heat points: [lat, lng, intensity]
export const FLOOD_POINTS = [
  // High
  [51.15, -2.85, 0.85], [51.48, 0.35, 0.9], [53.72, -0.35, 0.85],
  [52.5, 0.1, 0.8], [53.8, -1.52, 0.75], [53.96, -1.08, 0.8],
  [51.2, -2.9, 0.75], [51.5, 0.4, 0.8], [53.7, -0.4, 0.8],
  // Medium
  [51.5, -0.12, 0.55], [51.96, 1.35, 0.6], [51.45, -2.6, 0.55],
  [51.85, -2.25, 0.5], [53.38, -1.47, 0.5], [52.48, -1.9, 0.45],
  [53.41, -2.99, 0.5], [50.9, -1.4, 0.45],
  // Low
  [52.95, -1.15, 0.2], [54.97, -1.61, 0.25], [55.95, -3.19, 0.2],
  [56.46, -2.97, 0.15], [57.15, -2.1, 0.15], [54.6, -5.93, 0.2],
  [52.41, -1.78, 0.25], [53.0, -2.18, 0.2], [54.08, -2.79, 0.2],
  [50.72, -1.88, 0.2], [50.38, -4.14, 0.25], [51.62, -3.94, 0.3],
  [53.23, -4.13, 0.15],
];

export function riskLevel(r: number) {
  if (r < 0.33) return "Low";
  if (r < 0.66) return "Medium";
  return "High";
}

export function riskColor(r: number) {
  if (r < 0.33) return "#22C55E";
  if (r < 0.66) return "#F97316";
  return "#EF4444";
}

export function volumeToWidth(v: number) {
  const { min, max } = VOLUME_RANGE;
  const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
  return 2 + t * 8;
}

export type WarningSeverity = "severe" | "warning" | "advisory";
export type WarningKind = "flood" | "rain" | "storm" | "snow" | "traffic" | "closure";

export interface WeatherWarning {
  id: string;
  kind: WarningKind;
  severity: WarningSeverity;
  title: string;
  region: string;
  lat: number;
  lng: number;
  radiusKm: number;
  startsIn: string; // human readable
  duration: string;
  issued: string;
  description: string;
  // disrupted edges keyed as `sourceId->targetId` — applies across products
  disrupts: string[];
  impact: string;
}

export const WARNINGS: WeatherWarning[] = [
  {
    id: "w1",
    kind: "flood",
    severity: "severe",
    title: "Severe flood warning — River Thames Estuary",
    region: "Greater London & Essex",
    lat: 51.5,
    lng: 0.35,
    radiusKm: 55,
    startsIn: "in 6 h",
    duration: "36 h",
    issued: "Met Office · 14:20 UTC",
    description:
      "Tidal surge combined with 60 mm rainfall expected to overtop defences along the Thames estuary. Roads around Dartford Crossing and A13 corridor likely impassable.",
    disrupts: ["heath->dav", "felix->dav", "dav->lon_w", "lon_w->rlh"],
    impact: "Disrupts inbound flows to NHS Daventry from Heathrow & Felixstowe, plus London last-mile.",
  },
  {
    id: "t2",
    kind: "traffic",
    severity: "warning",
    title: "M25 heavy congestion — J13–J15 (Heathrow)",
    region: "Greater London orbital",
    lat: 51.46,
    lng: -0.48,
    radiusKm: 18,
    startsIn: "active now",
    duration: "3 h",
    issued: "TfL / National Highways · 15:30 UTC",
    description:
      "Multi-vehicle collision plus peak demand. Stop-start traffic both directions around Heathrow spurs. Average speed 12 mph.",
    disrupts: ["heath->dav", "glooko->heath", "abbott->heath", "menarini->heath", "insulet->heath", "tandem->heath", "sooil->heath", "dexcom->heath", "medtronic->heath"],
    impact: "All Heathrow inbound air freight & onward trunk to Daventry running 90–120 min late.",
  },
];

export const SEVERITY_COLORS: Record<WarningSeverity, string> = {
  severe: "#EF4444",
  warning: "#F97316",
  advisory: "#FACC15",
};

export const KIND_ICON: Record<WarningKind, string> = {
  flood: "💧",
  rain: "🌧",
  storm: "🌬",
  snow: "❄",
  traffic: "🚦",
  closure: "🚧",
};