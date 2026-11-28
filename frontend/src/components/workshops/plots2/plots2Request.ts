// G15 plot request builder: pure. Picks over a DataStruct's ANALYSIS view ->
// the `/api/export/figure` body whose `plots2` the server renders
// (calc/figure_parallel.py, figure_density2d.py, figure_agreement.py). The
// Stage preview and Export send the same body (screen == export).
//
// Column indices follow the aux-figure convention (-1 = the X column, then
// channels 0..); the wire counts [x, *channels] from 0 (`wireColumn`).
// Choices the owner has not made are PROVISIONAL (owner to confirm): Scott's-rule
// KDE bandwidth, 95 % CI level, 1.96 SD limits of agreement.

import type { FigureSpec } from "../../../lib/api/figures";
import { isCategoricalChannel, levelCountOf } from "../../../lib/categorical";
import type { Plots2Kind } from "../../../lib/plots2Mode";
import type { DataStruct } from "../../../lib/types";
import { cellValue, columnLabel, columnOptions } from "../ternary/auxColumns";

export type Plots2Cmap = "viridis" | "magma" | "gray" | "rdbu";

export interface Plots2Picks {
  /** parallel: axis columns in order; colorBy: color column or null. */
  cols: number[];
  colorBy: number | null;
  normalize: "minmax" | "zscore";
  /** density2d x/y and Bland-Altman methods A/B. */
  x: number;
  y: number;
  /** pareto category and value columns. */
  cat: number;
  val: number;
  gridsize: number;
  logCounts: boolean;
  bandwidth: "scott" | "silverman";
  showPoints: boolean;
  cmap: Plots2Cmap;
  percent: boolean;
  showCi: boolean;
}

export const wireColumn = (index: number): number => index + 1;
export const MIN_POINTS = 10;
export const MAX_PARALLEL_DEFAULT = 8;

/** The server's cap on Pareto categories (calc/figure_agreement.py `max_categories`). */
export const PARETO_MAX_CATEGORIES = 30;
/** `picks.cat` when no column can be a Pareto category: the picker opens empty, with a hint. */
export const NO_CATEGORY = -2;

/** Does column `index` have at most `PARETO_MAX_CATEGORIES` distinct finite values? */
function fewLevels(data: DataStruct, index: number): boolean {
  const n = levelCountOf(data.time.map((_, r) => cellValue(data, index, r)));
  return n > 0 && n <= PARETO_MAX_CATEGORIES;
}

/** Pareto's default category and value. The category is the first text/categorical column the bars can name
 *  (`candidates`: the sheet's channels plus its CSV text columns), else the first column with at most 30
 *  distinct values, else `NO_CATEGORY` (a continuous column would only open on the "exceed the Pareto limit"
 *  error). Never the X column (usually a numeric Time or index; UX menus audit N11). The value is the first
 *  other non-categorical real channel (`all`). */
function paretoDefaults(data: DataStruct, all: number[], candidates: number[]): { cat: number; val: number } {
  const channels = all.filter((i) => i >= 0);
  const usable = candidates.filter((i) => i >= 0 && fewLevels(data, i));
  const cat = usable.find((i) => isCategoricalChannel(data, i)) ?? usable[0] ?? NO_CATEGORY;
  const val = channels.find((i) => i !== cat && !isCategoricalChannel(data, i)) ?? all.find((i) => i !== cat) ?? channels[0] ?? all[0] ?? -1;
  return { cat, val };
}

/** Initial picks: every column (X first) for parallel, the first two channels
 *  for the paired plots, a text channel (else the first channel) as the Pareto
 *  category and the first other numeric channel as its value. */
export function guessPlots2Picks(data: DataStruct, width: number = data.labels.length): Plots2Picks {
  // `width` = the sheet's real channels: appended text columns (see usePlots2) are never a default pick.
  const all = columnOptions(data).map((c) => c.index).filter((i) => i < width);
  const second = all[1] ?? all[0] ?? -1;
  const pareto = paretoDefaults(data, all, columnOptions(data).map((c) => c.index)); // the text columns past `width` may be the category
  // Paired plots start on the first two CHANNELS (the X column is often a run
  // index or a sweep axis); with fewer, they fall back to X and the channel.
  const a = all.length >= 3 ? all[1]! : (all[0] ?? -1);
  const b = all.length >= 3 ? all[2]! : second;
  return {
    cols: all.slice(0, MAX_PARALLEL_DEFAULT),
    colorBy: null,
    normalize: "minmax",
    x: a,
    y: b,
    cat: pareto.cat,
    val: pareto.val,
    gridsize: 30,
    logCounts: false,
    bandwidth: "scott",
    showPoints: false,
    cmap: "viridis",
    percent: false,
    showCi: true,
  };
}

export interface Plots2Build {
  /** null when nothing can be requested; `problem` says why. */
  spec: FigureSpec | null;
  problem: string | null;
  /** Rows left out because a picked column is not a finite number. */
  dropped: number;
}

const finite = (data: DataStruct, picks: number[], r: number): boolean =>
  picks.every((p) => Number.isFinite(cellValue(data, p, r)));

/** The columns the kind reads, for the dropped-row count. */
function usedColumns(kind: Plots2Kind, p: Plots2Picks): number[] {
  if (kind === "parallel") return p.colorBy === null ? p.cols : [...p.cols, p.colorBy];
  if (kind === "pareto") return [p.cat, p.val];
  return [p.x, p.y];
}

export function buildPlots2Request(
  data: DataStruct,
  kind: Plots2Kind,
  p: Plots2Picks,
  opts: { title: string; filename: string },
): Plots2Build {
  const used = usedColumns(kind, p);
  let kept = 0;
  for (let r = 0; r < data.time.length; r++) if (finite(data, used, r)) kept++;
  const dropped = data.time.length - kept;
  const fail = (problem: string): Plots2Build => ({ spec: null, problem, dropped });
  if (kind === "pareto" && p.cat === NO_CATEGORY) {
    return fail(`Pick a Category column: no column has ${PARETO_MAX_CATEGORIES} or fewer distinct values.`);
  }
  if (kind === "parallel") {
    if (new Set(p.cols).size < 2) return fail("Pick at least two different columns for the axes.");
  } else if (kind !== "pareto" && p.x === p.y) {
    return fail(kind === "blandAltman" ? "Pick two different columns for the two methods." : "Pick two different columns for x and y.");
  }
  const minRows = kind === "hexbin" || kind === "kde2d" ? MIN_POINTS : kind === "parallel" ? 2 : kind === "blandAltman" ? 3 : 1;
  if (kept < minRows) return fail(`This plot needs at least ${minRows} rows with every picked value; ${kept} qualify.`);

  const plots2: NonNullable<FigureSpec["plots2"]> = {
    kind: kind === "hexbin" || kind === "kde2d" ? "density2d" : kind === "blandAltman" ? "bland_altman" : kind,
    cmap: p.cmap,
  };
  if (kind === "parallel") {
    plots2.cols = p.cols.map(wireColumn);
    plots2.normalize = p.normalize;
    if (p.colorBy !== null) plots2.color_col = wireColumn(p.colorBy);
  } else if (kind === "hexbin" || kind === "kde2d") {
    Object.assign(plots2, {
      x_col: wireColumn(p.x), y_col: wireColumn(p.y), method: kind === "hexbin" ? "hexbin" : "kde",
      gridsize: p.gridsize, log_counts: p.logCounts, bandwidth: p.bandwidth, show_points: p.showPoints,
    });
  } else if (kind === "blandAltman") {
    Object.assign(plots2, { x_col: wireColumn(p.x), y_col: wireColumn(p.y), percent: p.percent, show_ci: p.showCi });
  } else {
    Object.assign(plots2, { cat_col: wireColumn(p.cat), value_col: wireColumn(p.val) });
  }
  const spec: FigureSpec = { dataset: data, plots2, title: opts.title, filename: opts.filename };
  if (kind === "hexbin" || kind === "kde2d") {
    spec.x_label = columnLabel(data, p.x);
    spec.y_label = columnLabel(data, p.y);
  }
  return { spec, problem: null, dropped };
}
