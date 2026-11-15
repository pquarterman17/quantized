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
// as given; a `.dwk` load and every reader validate it in full:
// `sanitizeLayers`, lib/graphLayersSanitize.ts).

import { NO_CURVES_REASON } from "./linkedCurvesLite";
import { ownXKey } from "./perSeriesX";
import { droppedRows } from "./rowstate";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS, type InsetLayer, type LayerAxis, type LayerScale } from "./graphLayersSanitize";
import type { Dataset } from "./types";
import { fixedLinearAxisSplits, niceLinearStep } from "./uplotOpts";

export * from "./graphLayersSanitize";

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
 *  drops them). "Its own X" (`xKey` null) is the main graph's rule: the Y's
 *  nearest preceding X column on a multi-X book (T1,R1,T2,R2: R2 against T2),
 *  else the book's X. A point a log axis cannot show (<= 0) is a gap, on both
 *  sides. A curve whose dataset or column is gone is skipped — never rebound
 *  (fail closed). */
export function resolveInsetCurves(layer: InsetLayer, datasets: readonly Dataset[]): ResolvedCurve[] {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const out: ResolvedCurve[] = [];
  layer.curves.forEach((c, slot) => {
    const ds = byId.get(c.datasetId);
    const width = ds?.data.labels.length ?? 0;
    if (!ds || c.yKey < 0 || c.yKey >= width || (c.xKey !== null && (c.xKey < 0 || c.xKey >= width))) return;
    const drop = droppedRows(ds);
    const xk = c.xKey === null ? ownXKey(ds, null, c.yKey) : c.xKey;
    const [logX, logY] = [layer.x.scale === "log", layer.y.scale === "log"];
    const x: number[] = [];
    const y: (number | null)[] = [];
    ds.data.time.forEach((t, r) => {
      if (drop.has(r)) return;
      const xv = xk === null ? t : ds.data.values[r]?.[xk];
      const yv = ds.data.values[r]?.[c.yKey];
      if (typeof xv !== "number" || !Number.isFinite(xv)) return;
      x.push(xv);
      const ok = typeof yv === "number" && Number.isFinite(yv) && !(logY && yv <= 0) && !(logX && xv <= 0);
      y.push(ok ? yv : null);
    });
    out.push({ slot, x, y });
  });
  return out;
}

/** The notice an inset shows instead of curves, or null when it has some:
 *  "" (a framed, empty inset) when it has none bound yet — the screen adds
 *  its own hint (`EMPTY_INSET_HINT`), which never reaches the export. */
export function insetNotice(layer: InsetLayer, resolved: readonly ResolvedCurve[]): string | null {
  if (resolved.length) return null;
  return layer.curves.length ? NO_CURVES_REASON : "";
}

export const EMPTY_INSET_HINT = "No curves yet: add one in the layer's properties";

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
    return cleanPair(10 ** (a - pad), 10 ** (b + pad));
  }
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.05;
  return cleanPair(lo - pad, hi + pad);
}

/** 12-significant-digit ends, unless that would collapse a span that is tiny
 *  next to its magnitude (epoch-ms X: 1.7e12 .. 1.7e12 + 3). */
function cleanPair(lo: number, hi: number): [number, number] {
  const [a, b] = [Number(lo.toPrecision(12)), Number(hi.toPrecision(12))];
  return a < b ? [a, b] : [lo, hi];
}

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
  // An exponent label's mantissa gets as many digits as it takes for
  // neighbouring ticks to read differently (an FMR sweep: 9.4002e9 .. 9.4003e9).
  for (let m = 3; ; m++) {
    const out = ticks.map((t) => {
      if (plain(t)) return t.toFixed(Math.min(20, Math.max(scale === "log" ? precisionOf(t) : d, m - 3)));
      const mant = t / 10 ** Math.floor(Math.log10(Math.abs(t)));
      return t.toExponential(Math.min(m, Math.max(precisionOf(mant), m - 3))).replace("e+", "e");
    });
    if (m >= 15 || new Set(out).size === out.length) return out;
  }
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
