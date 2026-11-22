// The point-label layout (gap audit 8, LBL; setting: lib/pointLabels.ts). ONE pure
// function decides which points are labelled and with what text. The live canvas
// (Stage/usePointLabels) and the export request (lib/figurePointLabels.ts) both
// call it with the same inputs, and the export draws the list it returns, so the
// two cannot disagree.
//
// Rules (each has a test):
//  * Rows dropped from analysis (manual exclusion or the data filter) are never
//    labelled, and neither is a point with a non-finite x or y or a blank label.
//  * Selection: "all" labels every point, "selected" the rows selected in the
//    worksheet, "top" the N points furthest from zero in |y|. "all" refuses above
//    MAX_ALL_POINTS labelable points (stated, nothing drawn): pick Top N or Selected.
//  * Collision rule: the plot's extent (every plotted point) is cut into a
//    GRID_X x GRID_Y grid and each cell keeps one label, chosen by |y| (largest
//    first, then row order), so crowded labels thin deterministically, independent
//    of the pixel size. That also caps the labels at GRID_X * GRID_Y; a thinned
//    layout says how many were left out.
//  * Fail closed: a view the labels cannot honestly sit on (exchanged axes,
//    waterfall, grouped / encoded / faceted / two-axis plots, ...) draws none and
//    names why.

import { categoricalLevels, labelForCode } from "./categorical";
import { perSeriesXData } from "./perSeriesX";
import { MAX_ALL_POINTS, MAX_LABEL_CHARS, type PointLabels } from "./pointLabels";
import type { DataStruct, Dataset } from "./types";

export const GRID_X = 14;
export const GRID_Y = 10;

/** One labelled point: data coordinates, the text, the dataset row (0-based),
 *  the dataset channel and its index among the shown curves. */
export interface LabelPoint { x: number; y: number; text: string; row: number; ch: number; s: number }
export interface LabelLayout { points: LabelPoint[]; note: string | null; refusal: string | null }
export const NO_LABELS: LabelLayout = { points: [], note: null, refusal: null };

/** The label text of one dataset row (a category name, or the number to 6
 *  significant digits), or null when blank / not a number. */
export function labelText(data: DataStruct, key: number, row: number): string | null {
  return labelTexter(data, key)(row);
}

/** `labelText` for many rows of one column: the category table is read once. */
export function labelTexter(data: DataStruct, key: number): (row: number) => string | null {
  const levels = categoricalLevels(data, key);
  return (row) => {
    const v = data.values[row]?.[key];
    if (v === undefined || !Number.isFinite(v)) return null;
    const raw = levels ? labelForCode(levels, v) : String(Number(v.toPrecision(6)));
    const t = raw?.trim();
    if (!t) return null;
    return t.length > MAX_LABEL_CHARS ? `${t.slice(0, MAX_LABEL_CHARS - 1)}…` : t;
  };
}

/** The one line the plot and the export print under the labels: a refusal
 *  ("Point labels are not drawn ...") or a thinning / empty note; null when none. */
export function layoutMessage(l: LabelLayout): string | null {
  return l.refusal ? `Point labels ${l.refusal}` : l.note;
}

export interface LabelViewState {
  xScale: string;
  yScale: string;
  exchangeXY: boolean;
  waterfall: number;
  waterfallDx: number;
  /** Any series drawn as horizontal bars turns the whole layer. */
  horizontalBars: boolean;
  /** A group split, an encoding, a facet grid or a secondary Y axis is bound. */
  split: boolean;
}

/** Why labels cannot be drawn on this view at all, or null. The export sends no
 *  labels in the same cases. */
export function pointLabelsViewRefusal(v: LabelViewState): string | null {
  if (v.xScale === "reciprocal" || v.yScale === "reciprocal") return "are not drawn on a reciprocal axis";
  if (v.exchangeXY) return "are not drawn with exchanged X and Y axes";
  if (v.horizontalBars) return "are not drawn on a graph turned by horizontal bars";
  if (v.waterfall !== 0 || v.waterfallDx !== 0) return "are not drawn on a waterfall (its offsets are display-only)";
  if (v.split) return "are not drawn with a group, encoding, facet or secondary Y axis";
  return null;
}

export interface LabelInputs {
  dataset: Pick<Dataset, "data" | "columnDesignations">;
  /** Rows dropped from analysis (`droppedRows`). */
  dropped: ReadonlySet<number>;
  xKey: number | null;
  /** The shown (not hidden) plotted channels, in draw order. */
  channels: readonly number[];
  /** A shown curve has a decade offset on a log Y axis (display-only). */
  logOffset: boolean;
  view: LabelViewState;
  spec: PointLabels;
  /** The worksheet selection for THIS dataset, or null when none. */
  selected: ReadonlySet<number> | null;
}

interface Cand { x: number; y: number; row: number; ch: number; s: number }

const usable = (scale: string, v: number): boolean => Number.isFinite(v) && (scale !== "log" || v > 0);
const tr = (scale: string, v: number): number => (scale === "log" ? Math.log10(v) : v);
const cellOf = (t: number, lo: number, hi: number, n: number): number =>
  hi > lo ? Math.min(n - 1, Math.floor(((t - lo) / (hi - lo)) * n)) : 0;

/** Decide the labels. Never throws; a refusal is in `refusal`, a thinning or an
 *  empty result in `note`. */
export function layoutPointLabels(inp: LabelInputs): LabelLayout {
  const { data } = inp.dataset;
  const { spec, view } = inp;
  const why = pointLabelsViewRefusal(view);
  if (why) return { ...NO_LABELS, refusal: why };
  if (inp.logOffset) return { ...NO_LABELS, refusal: "are not drawn with per-curve decade offsets" };
  if (perSeriesXData(inp.dataset, inp.xKey, inp.channels)) {
    return { ...NO_LABELS, refusal: "are not drawn when the curves sit on different X columns" };
  }
  if (spec.key >= (data.values[0]?.length ?? 0)) return { ...NO_LABELS, refusal: "cannot be drawn: the label column no longer exists" };
  if (spec.mode === "selected" && (!inp.selected || inp.selected.size === 0)) {
    return { ...NO_LABELS, note: "No rows selected: select rows in the worksheet to label them." };
  }
  const chans = inp.channels.filter((c) => c !== spec.key);
  const n = data.values.length;
  const textOf = labelTexter(data, spec.key);
  const xAt = (r: number): number => (inp.xKey === null ? data.time[r] : data.values[r][inp.xKey]);

  // Pass 1: the plot's extent (every plotted point) and how many are labelable.
  let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity, labelable = 0;
  for (let r = 0; r < n; r++) {
    if (inp.dropped.has(r)) continue;
    const x = xAt(r);
    if (!usable(view.xScale, x)) continue;
    const hasText = textOf(r) !== null;
    for (const ch of chans) {
      const y = data.values[r][ch];
      if (!usable(view.yScale, y)) continue;
      const tx = tr(view.xScale, x), ty = tr(view.yScale, y);
      xLo = Math.min(xLo, tx);
      xHi = Math.max(xHi, tx);
      yLo = Math.min(yLo, ty);
      yHi = Math.max(yHi, ty);
      if (hasText) labelable++;
    }
  }
  if (spec.mode === "all" && labelable > MAX_ALL_POINTS) {
    const f = (v: number) => v.toLocaleString("en-US");
    return { ...NO_LABELS, refusal: `cannot be drawn: ${f(labelable)} points is over the ${f(MAX_ALL_POINTS)} limit for "All points" (choose Top N or Selected rows)` };
  }

  // Pass 2: the candidates for the chosen mode.
  const cands: Cand[] = [];
  for (let r = 0; r < n; r++) {
    if (inp.dropped.has(r) || (spec.mode === "selected" && !inp.selected?.has(r))) continue;
    const x = xAt(r);
    if (!usable(view.xScale, x) || textOf(r) === null) continue;
    for (const ch of chans) {
      const y = data.values[r][ch];
      if (usable(view.yScale, y)) cands.push({ x, y, row: r, ch, s: inp.channels.indexOf(ch) });
    }
  }
  cands.sort((a, b) => Math.abs(b.y) - Math.abs(a.y) || a.row - b.row || a.s - b.s);
  const wanted = spec.mode === "top" ? cands.slice(0, spec.topN) : cands;
  if (wanted.length === 0) return { ...NO_LABELS, note: "No points with a label value to label." };

  // Collision rule: one label per grid cell, largest |y| first.
  const taken = new Set<number>();
  const points: LabelPoint[] = [];
  for (const c of wanted) {
    const id = cellOf(tr(view.yScale, c.y), yLo, yHi, GRID_Y) * GRID_X + cellOf(tr(view.xScale, c.x), xLo, xHi, GRID_X);
    if (taken.has(id)) continue;
    taken.add(id);
    points.push({ x: c.x, y: c.y, text: textOf(c.row) as string, row: c.row, ch: c.ch, s: c.s });
  }
  const left = wanted.length - points.length;
  const note = left > 0 ? `${points.length} of ${wanted.length} labels drawn; ${left} crowded ${left === 1 ? "label" : "labels"} left out` : null;
  return { points, note, refusal: null };
}
