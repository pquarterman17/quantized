// Origin-style graph layers (origin gap audit 3 #15): objects positioned over
// the main plot that show something OTHER than the magnifier's same-data
// zoom — an inset graph of any datasets' curves with its own axes, an
// inserted image, and a small table. `PlotView.layers` holds them, so they
// save with the window (.dwk), the saved figure document and the undo
// history like every other view field.
//
// Placement is the magnifier's convention (`InsetView.at`): [left, top,
// width, height] as fractions of the main plot frame, top-origin. For an
// inset graph that rect is its PLOT AREA (tick labels hang outside it, as
// matplotlib's `inset_axes` places them); for an image or table it is the
// object itself. The screen (`Stage/GraphLayers.tsx`) and the vector export
// (`calc/figure_layers.py`) both read the rect and the RESOLVED axes this
// module computes — the range, the tick positions and their label text — so
// neither side autoscales or picks ticks on its own and the two cannot drift.
//
// An inset graph's curves are `LinkedCurve`s (Layer Contents' model): a
// (datasetId, xKey, yKey) reference, read live. A curve whose dataset or
// column is gone is NOT drawn and never rebinds to another one (fail
// closed); with none left the inset shows the live graph's own notice.
//
// Pure; imported only by lazy code (the eager `.dwk` reader keeps the list
// as given, and every reader validates it here: `sanitizeLayers`).

import { NO_CURVES_REASON } from "./linkedCurvesLite";
import { droppedRows } from "./rowstate";
import type { Dataset, LinkedCurve } from "./types";
import { fixedLinearAxisSplits, niceLinearStep } from "./uplotOpts";

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
const IMAGE_URL = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const RASTER_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

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
  inset: [0.56, 0.08, 0.38, 0.36],
  image: [0.06, 0.06, 0.3, 0.3],
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
    const l = sanitizeLayer(raw);
    if (l && !seen.has(l.id)) {
      seen.add(l.id);
      out.push(l);
    }
  }
  return out;
}

// ── Inset graph: curves, ranges, ticks ────────────────────────────────────

export interface ResolvedCurve {
  /** Position in the layer's curve list (its colour slot). */
  slot: number;
  x: number[];
  /** null = a gap (a non-finite cell), drawn as a break on both sides. */
  y: (number | null)[];
}

/** The curves the inset draws: each bound column read off its LIVE source,
 *  without the source's masked or filtered-out rows (as the main graph
 *  drops them). A curve whose dataset or column is gone is skipped — never
 *  rebound (fail closed). */
export function resolveInsetCurves(layer: InsetLayer, datasets: readonly Dataset[]): ResolvedCurve[] {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const out: ResolvedCurve[] = [];
  layer.curves.forEach((c, slot) => {
    const ds = byId.get(c.datasetId);
    const width = ds?.data.labels.length ?? 0;
    if (!ds || c.yKey < 0 || c.yKey >= width || (c.xKey !== null && (c.xKey < 0 || c.xKey >= width))) return;
    const drop = droppedRows(ds);
    const x: number[] = [];
    const y: (number | null)[] = [];
    ds.data.time.forEach((t, r) => {
      if (drop.has(r)) return;
      const xv = c.xKey === null ? t : ds.data.values[r]?.[c.xKey];
      const yv = ds.data.values[r]?.[c.yKey];
      if (typeof xv !== "number" || !Number.isFinite(xv)) return;
      x.push(xv);
      y.push(typeof yv === "number" && Number.isFinite(yv) ? yv : null);
    });
    out.push({ slot, x, y });
  });
  return out;
}

/** The notice an inset shows instead of curves, or null when it has some. */
export function insetNotice(layer: InsetLayer, resolved: readonly ResolvedCurve[]): string | null {
  if (resolved.length) return null;
  return layer.curves.length ? NO_CURVES_REASON : "No curves yet: add one in the layer's properties";
}

/** The range an axis draws over `values`: its typed limits when they are
 *  valid for the scale, else the data's extent with a 5% pad (log: in
 *  decades; positive values only). [0, 1] (log [1, 10]) with nothing to show. */
export function layerAxisRange(axis: LayerAxis, values: readonly (number | null)[]): [number, number] {
  const log = axis.scale === "log";
  if (axis.lim && (!log || axis.lim[0] > 0)) return [axis.lim[0], axis.lim[1]];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v) || (log && v <= 0)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi >= lo)) return log ? [1, 10] : [0, 1];
  if (log) {
    const [a, b] = [Math.log10(lo), Math.log10(hi)];
    const pad = (b - a || 1) * 0.05;
    return [clean(10 ** (a - pad)), clean(10 ** (b + pad))];
  }
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.05;
  return [clean(lo - pad), clean(hi + pad)];
}

const clean = (v: number) => Number(v.toPrecision(12));

/** Tick positions for `range`: log = every decade inside it (a nice linear
 *  step when fewer than two fall inside); linear = multiples of the step
 *  (the axis's own, else a nice one for ~4 ticks). */
export function layerTicks(range: [number, number], scale: LayerScale, step: number | null): number[] {
  const [lo, hi] = range;
  if (scale === "log" && lo > 0) {
    const out: number[] = [];
    for (let k = Math.ceil(Math.log10(lo) - 1e-9); 10 ** k <= hi * (1 + 1e-9) && out.length < 40; k++) {
      out.push(Number(`1e${k}`));
    }
    if (out.length >= 2) return out;
  }
  const s = step && step > 0 && (hi - lo) / step <= 50 ? step : niceLinearStep(hi - lo, 4);
  return fixedLinearAxisSplits(lo, hi, s);
}

/** The ticks' text: on a linear axis one shared number of decimals (the
 *  most any tick needs: 0.00, 0.25, 0.50), on a log axis each its own (0.01,
 *  0.1, 1); an exponent for magnitudes >= 1e5 or < 1e-3. */
export function layerTickLabels(ticks: readonly number[], scale: LayerScale = "linear"): string[] {
  const plain = (t: number) => t === 0 || (Math.abs(t) < 1e5 && Math.abs(t) >= 1e-3);
  const d = Math.max(0, ...ticks.filter(plain).map(precisionOf));
  return ticks.map((t) => {
    if (plain(t)) return t.toFixed(scale === "log" ? precisionOf(t) : d);
    const mant = t / 10 ** Math.floor(Math.log10(Math.abs(t)));
    return t.toExponential(Math.min(3, precisionOf(mant))).replace("e+", "e");
  });
}

/** Decimal places a value prints with (0.25 -> 2), capped at 6. */
function precisionOf(v: number): number {
  for (let d = 0; d <= 6; d++) if (Math.abs(Number(v.toFixed(d)) - v) <= Math.abs(v) * 1e-9) return d;
  return 6;
}

export interface ResolvedAxis {
  range: [number, number];
  scale: LayerScale;
  label: string;
  ticks: number[];
  labels: string[];
}

/** Everything both renderers draw an inset axis from. */
export function resolveAxis(axis: LayerAxis, values: readonly (number | null)[]): ResolvedAxis {
  const range = layerAxisRange(axis, values);
  const ticks = layerTicks(range, axis.scale, axis.step);
  return { range, scale: axis.scale, label: axis.label, ticks, labels: layerTickLabels(ticks, axis.scale) };
}

/** The inset's two resolved axes over its resolved curves. */
export function resolveInsetAxes(layer: InsetLayer, curves: readonly ResolvedCurve[]): { x: ResolvedAxis; y: ResolvedAxis } {
  return {
    x: resolveAxis(layer.x, curves.flatMap((c) => c.x)),
    y: resolveAxis(layer.y, curves.flatMap((c) => c.y)),
  };
}

// ── Tables ────────────────────────────────────────────────────────────────

/** Typed cells: one row per line, cells split on tabs (else commas). */
export function parseTableText(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const sep = text.includes("\t") ? "\t" : ",";
  return lines.slice(0, MAX_TABLE_ROWS).map((l) => l.split(sep).slice(0, MAX_TABLE_COLS).map((c) => c.trim()));
}

export function tableText(rows: readonly string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

/** Worksheet rows `first..last` (1-based, inclusive) of `ds` as table cells:
 *  the X column then every value column, optionally under a header row of
 *  column names. A snapshot: the table does not follow later edits. */
export function tableFromRows(ds: Dataset, first: number, last: number, header: boolean): string[][] {
  const m = ds.data.metadata ?? {};
  const xName = String(m.x_column_long || m.x_column_name || "X");
  const cols = ds.data.labels.slice(0, MAX_TABLE_COLS - 1);
  const lo = Math.max(1, Math.min(first, last));
  const hi = Math.min(ds.data.time.length, Math.max(first, last), lo + MAX_TABLE_ROWS - (header ? 2 : 1));
  const cell = (v: unknown) => (typeof v === "number" ? (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : "") : String(v ?? ""));
  const rows: string[][] = header ? [[xName, ...cols]] : [];
  for (let r = lo - 1; r < hi; r++) rows.push([cell(ds.data.time[r]), ...cols.map((_, c) => cell(ds.data.values[r]?.[c]))]);
  return rows.length ? rows : [[""]];
}
