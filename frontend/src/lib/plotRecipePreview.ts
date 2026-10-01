// Plot recipe preview capture (F4.2 / audit P1.3 "preview thumbnails"). A
// recipe carries no data, so a thumbnail has to be taken when the recipe is
// SAVED, from the plot the user is looking at: up to 4 of its visible series,
// each downsampled to at most 48 points and normalized to [0, 1] on the
// plot's own axes (log where the axis is log, so a log-scaled recipe's
// thumbnail looks like its plot). Y series share one vertical range, Y2
// series share their own, exactly as the plot draws them. Rows dropped from
// analysis (excluded outliers, or rows the data filter narrows out -- the
// `lib/rowstate` model's `droppedRows`) are left out.
//
// Rounded to 3 decimals: a thumbnail is ~50 px tall, and the rounding keeps
// a recipe's JSON small and diffable. Pure; part of the lazy capture chunk.

import { PREVIEW_MAX_POINTS, PREVIEW_MAX_SERIES } from "./plotRecipeMigrate";
import { facetGridSize } from "./facetGrid";
import type { PlotRecipe, RecipePreview } from "./plotRecipeSchema";
import { droppedRows } from "./rowstate";
import type { PlotView } from "./plotview";
import type { AxisScale, Dataset } from "./types";

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** The value an axis actually spaces points by, or NaN where it can't draw
 *  one (non-finite, non-positive on a log axis, zero on a reciprocal one). */
function axisValue(v: number, scale: AxisScale | null): number {
  if (!Number.isFinite(v)) return NaN;
  if (scale === "log") return v > 0 ? Math.log10(v) : NaN;
  if (scale === "reciprocal") return v !== 0 ? 1 / v : NaN;
  return v;
}

function extent(values: readonly number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

const norm = (v: number, [lo, hi]: [number, number]): number => (hi > lo ? (v - lo) / (hi - lo) : 0.5);

/** Evenly spaced picks of at most `max` items, always keeping both ends. */
function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]);
}

/** What the thumbnail draws besides the curves (Q6): the recipe's multi-panel
 *  grid, if any, and whether it carries a map view. Derived at render time
 *  from what the recipe recorded, so every v3 recipe gets it. */
export interface PreviewGlyph {
  grid: { rows: number; cols: number } | null;
  map: boolean;
}

/** `grid` is a spatial composition's cell extent, or a composite panel
 *  window's shape (`lib/panelwindow.ts`'s `panelGridShape`, mirrored here
 *  so this chunk stays free of its render helpers); null for one plot,
 *  including an overlay window. */
export function previewGlyph(r: Pick<PlotRecipe, "panels" | "map" | "panelWindow">): PreviewGlyph {
  let grid: PreviewGlyph["grid"] = null;
  if (r.panels) {
    grid = { rows: Math.max(...r.panels.panels.map((p) => p.row)) + 1, cols: Math.max(...r.panels.panels.map((p) => p.col)) + 1 };
  } else if (r.panelWindow && r.panelWindow.layout !== "overlay") {
    const n = r.panelWindow.datasets.length;
    grid = r.panelWindow.layout === "row" ? { rows: 1, cols: n } : r.panelWindow.layout === "column" ? { rows: n, cols: 1 } : facetGridSize(n);
  }
  return { grid: grid && grid.rows * grid.cols > 1 ? grid : null, map: Boolean(r.map) };
}

/** The preview of `view` over `dataset`, or null when nothing is plottable. */
export function capturePreview(dataset: Dataset, view: PlotView): RecipePreview | null {
  const { values, time } = dataset.data;
  const width = values[0]?.length ?? 0;
  const hidden = new Set(view.hiddenChannels);
  const usable = (ch: number): boolean => ch >= 0 && ch < width && ch !== view.xKey && !hidden.has(ch);
  const y1 = (view.yKeys ?? []).filter(usable);
  const y2 = (view.y2Keys ?? []).filter(usable);
  const picked = [...y1.map((ch) => ({ ch, y2: false })), ...y2.map((ch) => ({ ch, y2: true }))].slice(0, PREVIEW_MAX_SERIES);
  if (picked.length === 0) return null;

  const dropped = droppedRows(dataset);
  const rows = values.map((_, i) => i).filter((i) => !dropped.has(i));
  const xs = rows.map((i) => axisValue(view.xKey !== null ? values[i][view.xKey] : (time[i] ?? i), view.xScale));
  const col = (ch: number, y2: boolean): number[] =>
    rows.map((i) => axisValue(values[i][ch], y2 ? (view.y2Scale ?? "linear") : view.yScale));
  const cols = picked.map((p) => col(p.ch, p.y2));

  const xExt = extent(xs);
  const yExt = extent(cols.filter((_, k) => !picked[k].y2).flat());
  const y2Ext = extent(cols.filter((_, k) => picked[k].y2).flat());
  if (!xExt) return null;

  const series = cols.flatMap((ys, k) => {
    const yRange = picked[k].y2 ? y2Ext : yExt;
    if (!yRange) return [];
    const pts: [number, number][] = [];
    ys.forEach((y, j) => {
      if (!Number.isNaN(xs[j]) && !Number.isNaN(y)) pts.push([round3(norm(xs[j], xExt)), round3(norm(y, yRange))]);
    });
    return pts.length > 0 ? [downsample(pts, PREVIEW_MAX_POINTS)] : [];
  });
  return series.length > 0 ? { series } : null;
}
