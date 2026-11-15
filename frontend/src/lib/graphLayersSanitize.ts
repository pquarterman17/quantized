// Graph layers' model and their full validation (origin gap audit 3 #15):
// the layer types, the caps and every sanitizer, split out of
// lib/graphLayers.ts so the `.dwk` reader (lib/workspace.ts, which also runs
// in the workspace-parse worker) validates layers without the renderer's
// imports. Pure; types only. lib/graphLayers.ts re-exports all of it.

import type { FigureDocument } from "./figureDocument";
import type { PlotWindow } from "./plotview";
import type { LinkedCurve } from "./types";

/** [left, top, width, height]: fractions of the main plot frame, top-origin. */
export type LayerAt = [number, number, number, number];
export type LayerScale = "linear" | "log";
export type LayerMark = "line" | "scatter" | "linesymbol";

export interface LayerAxis {
  /** [lo, hi]; null = automatic (from the curves, see `layerAxisRange`). */
  lim: [number, number] | null;
  scale: LayerScale;
  label: string;
  /** Major tick increment (linear); null = a nice step for the range. */
  step: number | null;
}

interface LayerBase {
  id: string;
  at: LayerAt;
}
export interface InsetLayer extends LayerBase {
  kind: "inset";
  curves: LinkedCurve[];
  x: LayerAxis;
  y: LayerAxis;
  mark: LayerMark;
}
export interface ImageLayer extends LayerBase {
  kind: "image";
  /** A data: URL (png, jpeg or svg+xml) — the screen shows it as given. */
  src: string;
  name: string;
  /** For an SVG: a PNG rendering of it, which the export embeds
   *  (matplotlib cannot read SVG). Absent for a PNG/JPEG. */
  raster?: string;
}
export interface TableLayer extends LayerBase {
  kind: "table";
  rows: string[][];
  /** The first row is a header (bold). */
  header: boolean;
}
export type GraphLayer = InsetLayer | ImageLayer | TableLayer;
export type LayerKind = GraphLayer["kind"];

/** The largest image a layer carries (data URL characters): images live in
 *  the workspace file. */
export const MAX_IMAGE_CHARS = 4_000_000;
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLS = 20;
/** A data URL whose bytes start as its label says: PNG's and JPEG's magic
 *  numbers (base64 `iVBORw0KGgo` / `/9j/`); an SVG is text starting `<`, a
 *  BOM or whitespace (`P`/`7`/`C`/`D`/`I`; the browser checks the rest). A
 *  mislabelled payload (a JPEG called PNG) would draw on screen but not in
 *  the export, so it is refused. */
const IMAGE_URL = /^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/|svg\+xml;base64,[P7CDI])[A-Za-z0-9+/=]*$/;
const RASTER_URL = /^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/)[A-Za-z0-9+/=]*$/;
/** At most this many layers per plot (the export's own cap). */
export const MAX_LAYERS = 32;
/** The largest image (pixels) a layer may hold: decoding is bounded on both sides. */
export const MAX_IMAGE_PIXELS = 25_000_000;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A placement kept inside the frame, at least 5% each way. */
export function clampLayerAt(v: unknown, fallback: LayerAt): LayerAt {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(finite)) return [...fallback];
  const c = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const w = c(v[2], 0.05, 1);
  const h = c(v[3], 0.05, 1);
  return [c(v[0], 0, 1 - w), c(v[1], 0, 1 - h), w, h];
}

export const DEFAULT_LAYER_AT: Record<LayerKind, LayerAt> = {
  // Clear of the legend's default top-right corner and of each other.
  inset: [0.08, 0.08, 0.38, 0.36],
  image: [0.06, 0.56, 0.3, 0.3],
  table: [0.62, 0.7, 0.32, 0.22],
};

export function defaultAxis(): LayerAxis {
  return { lim: null, scale: "linear", label: "", step: null };
}

function sanitizeAxis(v: unknown): LayerAxis {
  const o = obj(v) ?? {};
  const lim = Array.isArray(o.lim) && o.lim.length === 2 && o.lim.every(finite) && o.lim[0] < o.lim[1]
    ? ([o.lim[0], o.lim[1]] as [number, number])
    : null;
  return {
    lim,
    scale: o.scale === "log" ? "log" : "linear",
    label: typeof o.label === "string" ? o.label : "",
    step: finite(o.step) && o.step > 0 ? o.step : null,
  };
}

function sanitizeCurve(v: unknown): LinkedCurve | null {
  const o = obj(v);
  const idx = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= -1;
  if (!o || typeof o.datasetId !== "string" || !idx(o.yKey) || !(o.xKey === null || idx(o.xKey))) return null;
  return { datasetId: o.datasetId, xKey: o.xKey, yKey: o.yKey, label: typeof o.label === "string" ? o.label : "" };
}

/** One persisted layer, validated (null = drop it): a hand-edited or stale
 *  `.dwk` never reaches the screen or the export unchecked. */
export function sanitizeLayer(v: unknown): GraphLayer | null {
  const o = obj(v);
  if (!o || typeof o.id !== "string" || !o.id) return null;
  const kind = o.kind;
  if (kind !== "inset" && kind !== "image" && kind !== "table") return null;
  const at = clampLayerAt(o.at, DEFAULT_LAYER_AT[kind]);
  if (kind === "inset") {
    const curves = Array.isArray(o.curves) ? o.curves.map(sanitizeCurve).filter((c): c is LinkedCurve => !!c) : [];
    const mark: LayerMark = o.mark === "scatter" || o.mark === "linesymbol" ? o.mark : "line";
    return { id: o.id, kind, at, curves, x: sanitizeAxis(o.x), y: sanitizeAxis(o.y), mark };
  }
  if (kind === "image") {
    if (typeof o.src !== "string" || o.src.length > MAX_IMAGE_CHARS || !IMAGE_URL.test(o.src)) return null;
    const raster = typeof o.raster === "string" && o.raster.length <= MAX_IMAGE_CHARS && RASTER_URL.test(o.raster)
      ? { raster: o.raster }
      : {};
    // An SVG exports as its PNG rendering; without one it could not export
    // as shown, so it is not drawn on either side.
    if (o.src.startsWith("data:image/svg") && !raster.raster) return null;
    return { id: o.id, kind, at, src: o.src, name: typeof o.name === "string" ? o.name : "image", ...raster };
  }
  const rows = Array.isArray(o.rows)
    ? o.rows.slice(0, MAX_TABLE_ROWS).map((r) =>
        (Array.isArray(r) ? r : []).slice(0, MAX_TABLE_COLS).map((c) => (typeof c === "string" ? c : finite(c) ? String(c) : "")),
      )
    : [];
  return { id: o.id, kind, at, rows: rows.length ? rows : [[""]], header: o.header !== false };
}

/** A persisted layer list, validated; ids unique (a repeat is dropped). */
export function sanitizeLayers(v: unknown): GraphLayer[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: GraphLayer[] = [];
  for (const raw of v) {
    if (out.length >= MAX_LAYERS) break;
    const l = sanitizeLayer(raw);
    if (l && !seen.has(l.id)) {
      seen.add(l.id);
      out.push(l);
    }
  }
  return out;
}

/** A loaded window with every layer list it holds validated in full (its
 *  live view and its figure document's), so nothing unchecked from a `.dwk`
 *  reaches the store — the eager reader keeps the list as given. */
export function withValidLayers(w: PlotWindow): PlotWindow {
  if (w.kind !== "plot") return w;
  const document = w.document && withValidFigureLayers(w.document);
  return { ...w, view: { ...w.view, layers: sanitizeLayers(w.view.layers) }, ...(document ? { document } : {}) };
}

/** A loaded figure document with its layers validated in full. */
export function withValidFigureLayers(d: FigureDocument): FigureDocument {
  return { ...d, plot: { ...d.plot, view: { ...d.plot.view, layers: sanitizeLayers(d.plot.view.layers) } } };
}
