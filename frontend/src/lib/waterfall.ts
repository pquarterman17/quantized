// Multi-dataset waterfall: stack ONE Y channel across N datasets with a vertical
// offset, so a family of scans (e.g. XRD vs temperature, M-vs-H loops) reads as a
// legible cascade. Port of MATLAB
// `+bosonPlotter/+figureBuilder/generateWaterfall.m` (the across-datasets feature;
// the prior single-dataset across-channels `applyWaterfall` in plotdata.ts is a
// different, lesser thing). Pure core: data in → traces / CSV out. No rendering.

import type { DataStruct } from "./types";

export type OffsetMode = "add" | "mul";

export interface WaterfallSeries {
  id: string;
  label: string; // dataset display name
  x: number[];
  y: number[]; // raw channel values (may contain non-finite)
  range: number; // max−min of the finite y (0 if none) — drives auto-spacing
}

export interface WaterfallOptions {
  spacing: number; // resolved numeric step (>0)
  mode: OffsetMode; // additive (y + k·s) or multiplicative (y · sᵏ, for log data)
  reverse: boolean; // flip the stacking order (last dataset on the bottom)
}

export interface WaterfallTrace {
  id: string;
  label: string;
  x: number[];
  y: (number | null)[]; // offset applied; non-finite → null (gap)
  offset: number; // additive shift (add mode) or factor (mul mode) for this trace
}

/** Channel labels present in EVERY dataset (intersection, in the first dataset's
 *  order). A waterfall stacks one channel across datasets, so only shared channels
 *  can be offered. */
export function commonChannels(datasets: DataStruct[]): string[] {
  if (datasets.length === 0) return [];
  const [first, ...rest] = datasets;
  return first.labels.filter((lab) => rest.every((d) => d.labels.includes(lab)));
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Auto spacing = 0.8 × median of the positive per-trace y-ranges (MATLAB rule);
 *  falls back to 1 when no trace has a finite range. */
export function autoSpacing(ranges: number[]): number {
  const valid = ranges.filter((r) => r > 0 && Number.isFinite(r));
  return valid.length ? 0.8 * median(valid) : 1;
}

/** Pull a single channel (by label) out of a dataset as a waterfall series. x is
 *  the dataset's `.time` (the canonical independent axis). Missing channel → empty
 *  y (the trace renders as a gap, never throws). */
export function extractSeries(
  ds: DataStruct,
  id: string,
  label: string,
  channel: string,
): WaterfallSeries {
  const c = ds.labels.indexOf(channel);
  const x = ds.time.slice();
  const y = c < 0 ? [] : ds.values.map((row) => row[c]);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of y) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { id, label, x, y, range: hi > lo ? hi - lo : 0 };
}

/** Stacking position 0..n−1 per ORIGINAL index (reversed when `reverse`). Unlike
 *  MATLAB (which reverses paint order only and keeps offset tied to the original
 *  index), we flip the actual vertical positions — the intuitive meaning of
 *  "reverse stacking". */
function stackPositions(n: number, reverse: boolean): number[] {
  return Array.from({ length: n }, (_, i) => (reverse ? n - 1 - i : i));
}

/** Apply the offset to each series. Additive: y + k·spacing. Multiplicative:
 *  y · spacingᵏ (for log-scaled data). Trace i in the result aligns 1:1 with
 *  series i (draw order is irrelevant for lines, so original order is preserved). */
export function buildWaterfall(
  series: WaterfallSeries[],
  opts: WaterfallOptions,
): WaterfallTrace[] {
  const pos = stackPositions(series.length, opts.reverse);
  return series.map((s, i) => {
    const k = pos[i];
    const add = opts.mode === "add" ? k * opts.spacing : 0;
    const fac = opts.mode === "mul" ? Math.pow(opts.spacing || 1, k) : 1;
    const y = s.y.map((v) =>
      Number.isFinite(v) ? (opts.mode === "mul" ? v * fac : v + add) : null,
    );
    return { id: s.id, label: s.label, x: s.x, y, offset: opts.mode === "mul" ? fac : add };
  });
}

/** Merge per-trace (x, y) onto one uPlot-aligned grid: the sorted union of every
 *  x value, with each trace's y placed at its x (null elsewhere). For the common
 *  case (all datasets share an x grid) the union IS that grid. */
export function alignToUnionX(traces: WaterfallTrace[]): {
  x: number[];
  ys: (number | null)[][];
} {
  const xset = new Set<number>();
  for (const t of traces) for (const xv of t.x) if (Number.isFinite(xv)) xset.add(xv);
  const x = [...xset].sort((a, b) => a - b);
  const index = new Map(x.map((v, i) => [v, i]));
  const ys = traces.map((t) => {
    const col: (number | null)[] = new Array(x.length).fill(null);
    t.x.forEach((xv, j) => {
      const idx = index.get(xv);
      if (idx != null) col[idx] = t.y[j];
    });
    return col;
  });
  return { x, ys };
}

function csvEscape(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Consolidated CSV: each dataset contributes an `x` column and a `<channel>`
 *  column, side by side (ragged columns blank-fill). With `baked` the y columns
 *  carry the stacking offset (what you see on screen); without, they are the raw
 *  channel values. This is the user's "export with or without the waterfall
 *  offset" requirement. */
export function waterfallToCSV(
  series: WaterfallSeries[],
  opts: WaterfallOptions,
  channel: string,
  baked: boolean,
): string {
  const traces = baked ? buildWaterfall(series, opts) : null;
  const cols: { header: string; data: (number | null)[] }[] = [];
  series.forEach((s, i) => {
    cols.push({ header: `${s.label} x`, data: s.x });
    cols.push({ header: `${s.label} ${channel}`, data: baked ? traces![i].y : s.y });
  });
  const maxRows = cols.reduce((m, c) => Math.max(m, c.data.length), 0);
  const lines = [cols.map((c) => csvEscape(c.header)).join(",")];
  for (let r = 0; r < maxRows; r++) {
    lines.push(
      cols
        .map((c) => {
          const v = c.data[r];
          return v == null || !Number.isFinite(v as number) ? "" : String(v);
        })
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
