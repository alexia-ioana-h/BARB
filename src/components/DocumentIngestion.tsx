import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { NODE_TYPE_LABELS } from "@/data/mockData";

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

interface IngestionPayload {
  nodes?: Node[];
  edges?: Edge[];
}

interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  errors: string[];
  warnings: string[];
}

const VALID_TYPES = new Set(Object.keys(NODE_TYPE_LABELS));

function parsePayload(raw: unknown, existingNodeIds: Set<string>): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push("JSON must be an object with optional 'nodes' and 'edges' arrays.");
    return { nodes, edges, errors, warnings };
  }

  const payload = raw as IngestionPayload;

  // --- validate nodes ---
  if (payload.nodes !== undefined) {
    if (!Array.isArray(payload.nodes)) {
      errors.push("'nodes' must be an array.");
    } else {
      payload.nodes.forEach((n, i) => {
        const prefix = `nodes[${i}]`;
        if (!n.id || typeof n.id !== "string") {
          errors.push(`${prefix}: 'id' must be a non-empty string.`);
          return;
        }
        if (!n.label || typeof n.label !== "string")
          errors.push(`${prefix} (${n.id}): 'label' must be a non-empty string.`);
        if (!VALID_TYPES.has(n.type))
          errors.push(`${prefix} (${n.id}): 'type' must be one of: ${[...VALID_TYPES].join(", ")}.`);
        if (typeof n.lat !== "number" || n.lat < -90 || n.lat > 90)
          errors.push(`${prefix} (${n.id}): 'lat' must be a number between -90 and 90.`);
        if (typeof n.lng !== "number" || n.lng < -180 || n.lng > 180)
          errors.push(`${prefix} (${n.id}): 'lng' must be a number between -180 and 180.`);
        if (existingNodeIds.has(n.id))
          warnings.push(`Node '${n.id}' already exists and will be skipped.`);
        else if (errors.filter((e) => e.startsWith(prefix)).length === 0)
          nodes.push(n);
      });
    }
  }

  // --- validate edges ---
  if (payload.edges !== undefined) {
    if (!Array.isArray(payload.edges)) {
      errors.push("'edges' must be an array.");
    } else {
      const allNodeIds = new Set([...existingNodeIds, ...nodes.map((n) => n.id)]);
      payload.edges.forEach((e, i) => {
        const prefix = `edges[${i}]`;
        if (!e.sourceId || typeof e.sourceId !== "string")
          errors.push(`${prefix}: 'sourceId' must be a non-empty string.`);
        if (!e.targetId || typeof e.targetId !== "string")
          errors.push(`${prefix}: 'targetId' must be a non-empty string.`);
        if (typeof e.volume !== "number" || e.volume <= 0)
          errors.push(`${prefix}: 'volume' must be a positive number.`);
        if (typeof e.flood_risk !== "number" || e.flood_risk < 0 || e.flood_risk > 1)
          errors.push(`${prefix}: 'flood_risk' must be a number between 0 and 1.`);

        if (e.sourceId && !allNodeIds.has(e.sourceId))
          warnings.push(`Edge sourceId '${e.sourceId}' not found in node list.`);
        if (e.targetId && !allNodeIds.has(e.targetId))
          warnings.push(`Edge targetId '${e.targetId}' not found in node list.`);

        if (errors.filter((err) => err.startsWith(prefix)).length === 0)
          edges.push(e);
      });
    }
  }

  if (nodes.length === 0 && edges.length === 0 && errors.length === 0)
    warnings.push("No nodes or edges found — nothing to import.");

  return { nodes, edges, errors, warnings };
}

interface DocumentIngestionProps {
  open: boolean;
  onClose: () => void;
  existingNodeIds: Set<string>;
  onImport: (nodes: Node[], edges: Edge[]) => void;
  theme: "dark" | "light";
}

export default function DocumentIngestion({
  open,
  onClose,
  existingNodeIds,
  onImport,
  theme,
}: DocumentIngestionProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isDark = theme === "dark";

  function loadText(raw: string) {
    setText(raw);
    try {
      const parsed = JSON.parse(raw);
      setResult(parsePayload(parsed, existingNodeIds));
    } catch {
      setResult({
        nodes: [],
        edges: [],
        errors: ["Invalid JSON — could not parse."],
        warnings: [],
      });
    }
  }

  function handleFile(file: File) {
    if (!file.name.endsWith(".json")) {
      setResult({ nodes: [], edges: [], errors: ["File must be a .json file."], warnings: [] });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => loadText(e.target?.result as string);
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleImport() {
    if (!result || result.errors.length > 0) return;
    onImport(result.nodes, result.edges);
    reset();
    onClose();
  }

  function reset() {
    setText("");
    setResult(null);
  }

  const canImport = result !== null && result.errors.length === 0 && (result.nodes.length > 0 || result.edges.length > 0);

  const bg = isDark ? "#0d1117" : "#ffffff";
  const border = isDark ? "#2a3244" : "#e2e8f0";
  const textColor = isDark ? "#e5e7eb" : "#1e293b";
  const muted = isDark ? "#8a93a8" : "#64748b";
  const dropBg = dragOver
    ? isDark ? "#1a2235" : "#f0f9ff"
    : isDark ? "#111827" : "#f8fafc";
  const dropBorder = dragOver
    ? "#3B82F6"
    : isDark ? "#2a3244" : "#cbd5e1";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent
        style={{
          background: bg,
          border: `1px solid ${border}`,
          color: textColor,
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: textColor }}>Ingest supply chain document</DialogTitle>
          <p style={{ fontSize: 12, color: muted, marginTop: 4 }}>
            Upload or paste a JSON file containing nodes and/or edges to extend the graph.
          </p>
        </DialogHeader>

        {/* Schema hint */}
        <details style={{ fontSize: 11, color: muted, marginBottom: 8 }}>
          <summary style={{ cursor: "pointer", userSelect: "none", marginBottom: 4 }}>
            Expected JSON schema
          </summary>
          <pre
            style={{
              background: isDark ? "#0a0f1a" : "#f1f5f9",
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 10.5,
              color: isDark ? "#93c5fd" : "#334155",
              overflowX: "auto",
            }}
          >{`{
  "nodes": [
    {
      "id": "my_hospital",
      "label": "My Hospital",
      "type": "hospital",   // manufacturer | port | national_wh | regional_wh | hospital
      "lat": 51.5,
      "lng": -0.1
    }
  ],
  "edges": [
    {
      "sourceId": "dav",
      "targetId": "my_hospital",
      "volume": 50,         // £M/yr contract volume
      "flood_risk": 0.3    // 0–1
    }
  ]
}`}</pre>
        </details>

        {/* Drop zone */}
        <label
          htmlFor="di-file-input"
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          style={{
            display: "block",
            border: `2px dashed ${dropBorder}`,
            borderRadius: 8,
            background: dropBg,
            padding: "18px 12px",
            textAlign: "center",
            cursor: "pointer",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <Upload size={20} style={{ margin: "0 auto 6px", color: muted }} />
          <p style={{ fontSize: 12, color: muted, margin: 0 }}>
            Drop a <strong style={{ color: textColor }}>.json</strong> file here or{" "}
            <span style={{ color: "#3B82F6", textDecoration: "underline" }}>browse</span>
          </p>
          <input
            id="di-file-input"
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
        </label>

        <p style={{ fontSize: 11, color: muted, textAlign: "center", margin: "6px 0" }}>or paste JSON below</p>

        {/* Text area */}
        <textarea
          value={text}
          onChange={(e) => loadText(e.target.value)}
          placeholder='{ "nodes": [], "edges": [] }'
          rows={7}
          style={{
            width: "100%",
            background: isDark ? "#0a0f1a" : "#f8fafc",
            border: `1px solid ${border}`,
            borderRadius: 6,
            color: textColor,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            padding: "10px 12px",
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        {/* Validation feedback */}
        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {result.errors.length > 0 && (
              <div
                style={{
                  background: "#EF444418",
                  border: "1px solid #EF444455",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, color: "#EF4444", margin: "0 0 4px" }}>
                  {result.errors.length} error{result.errors.length > 1 ? "s" : ""}
                </p>
                {result.errors.map((e, i) => (
                  <p key={i} style={{ fontSize: 11, color: "#EF4444", margin: "2px 0" }}>• {e}</p>
                ))}
              </div>
            )}
            {result.warnings.length > 0 && (
              <div
                style={{
                  background: "#F9731618",
                  border: "1px solid #F9731655",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, color: "#F97316", margin: "0 0 4px" }}>
                  {result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}
                </p>
                {result.warnings.map((w, i) => (
                  <p key={i} style={{ fontSize: 11, color: "#F97316", margin: "2px 0" }}>• {w}</p>
                ))}
              </div>
            )}
            {canImport && (
              <div
                style={{
                  background: "#22C55E18",
                  border: "1px solid #22C55E55",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, color: "#22C55E", margin: 0 }}>
                  Ready to import: {result.nodes.length} node{result.nodes.length !== 1 ? "s" : ""},{" "}
                  {result.edges.length} edge{result.edges.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter style={{ gap: 8, marginTop: 4 }}>
          <button
            onClick={() => { reset(); onClose(); }}
            style={{
              padding: "7px 16px",
              borderRadius: 6,
              border: `1px solid ${border}`,
              background: "transparent",
              color: muted,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            style={{
              padding: "7px 18px",
              borderRadius: 6,
              border: "none",
              background: canImport ? "#3B82F6" : isDark ? "#1f2937" : "#e2e8f0",
              color: canImport ? "#ffffff" : muted,
              fontSize: 12,
              fontWeight: 600,
              cursor: canImport ? "pointer" : "not-allowed",
              transition: "background 0.15s",
            }}
          >
            Import
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
