// Curve Fit — the confidence/prediction band as a library dataset. Pure: no
// React, no store.
//
// Two forms. On the MAIN graph the band rides on the fit overlay
// (`FitOverlay.band`, the last section of this file) and is exported with the
// curve (lib/figureSpecOverlays.ts). "Plot with band" additionally lands it as
// a dataset whose channels are styled `fill: {vs}` (MAIN #13) — a native uPlot
// band on screen and `fill_between` in the export — so the band also exists as
// DATA: a smooth grid across the fitted range, kept in the project, the same
// way the reflectivity workshop's DREAM bands do (reflDreamBands.ts).
//
// Rows: every fitted point plus an even grid across the fitted x-range,
// sorted by x, so the band is smooth even for sparse data. The data column is
// NaN on the grid rows (drawn as markers only, so the gaps never show).

import type { BandsResult } from "../../../lib/api/fitStats";
import type { CalcResult, DataStruct, Dataset, FitOverlay, SeriesStyle } from "../../../lib/types";

/** The fit-specific fields of a /bands request, from the fit's own result:
 *  its point and free-parameter counts (the Student-t dof is the residual
 *  dof nPoints - nFree), its observation variance `MSE` (what the prediction
 *  band adds), and — for a weighted fit — its per-point `obsVar` at the fitted
 *  x. ONE builder for the band on the graph (useFitBands) and the band columns
 *  written to a worksheet (FitOutputSection), so the two can never disagree.
 *  A result without MSE (an older snapshot) sends `mse: null`: the route then
 *  returns no prediction limits rather than a wrong band. */
export function bandFitStats(result: CalcResult, fitX: readonly number[]): {
  n_points: number; n_free: number; mse: number | null; x_data?: number[]; obs_var?: (number | null)[];
} {
  const params = (result.params as number[] | undefined) ?? [];
  const mse = typeof result.MSE === "number" && Number.isFinite(result.MSE) ? result.MSE : null;
  const obsVar = Array.isArray(result.obsVar) && result.obsVar.length === fitX.length
    ? (result.obsVar as (number | null)[])
    : null;
  return {
    n_points: Number(result.nPoints ?? fitX.length),
    n_free: Number(result.nFree ?? params.length),
    mse,
    ...(obsVar ? { x_data: [...fitX], obs_var: obsVar } : {}),
  };
}

/** Band levels offered in the panel. */
export const BAND_LEVELS = [0.68, 0.9, 0.95, 0.99] as const;
/** Grid points added across the fitted x-range. */
export const BAND_GRID_POINTS = 256;

export const levelLabel = (level: number): string => `${Math.round(level * 100)}%`;

export interface BandRows {
  x: number[];
  /** The measured y on data rows, NaN on grid rows. */
  y: number[];
}

/** The band plot's rows: the fitted (x, y) points merged with an even grid of
 *  `nGrid` points over their x-range, ascending in x (stable for ties). */
export function bandRows(fx: readonly number[], fy: readonly number[], nGrid = BAND_GRID_POINTS): BandRows {
  const finite = fx.filter((v) => Number.isFinite(v));
  const rows: { x: number; y: number }[] = fx.map((x, i) => ({ x, y: fy[i] ?? Number.NaN }));
  if (finite.length > 0 && nGrid > 1) {
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    if (hi > lo) {
      for (let k = 0; k < nGrid; k++) rows.push({ x: lo + ((hi - lo) * k) / (nGrid - 1), y: Number.NaN });
    }
  }
  rows.sort((a, b) => a.x - b.x);
  return { x: rows.map((r) => r.x), y: rows.map((r) => r.y) };
}

export interface BandSource {
  datasetId: string;
  datasetName: string;
  model: string;
  xLabel: string;
  xUnit: string;
  yLabel: string;
  yUnit: string;
}

/** Labels/units for the band plot, read the way the plot names its axes
 *  (lib/plotdata.ts): the x column's long name, or the channel label. */
export function bandSourceFor(ds: Dataset, model: string, xKey: number | null, yKey: number): BandSource {
  const d = ds.data;
  const meta = d.metadata ?? {};
  return {
    datasetId: ds.id,
    datasetName: ds.name,
    model,
    xLabel: xKey == null ? String(meta["x_column_long"] || meta["x_column_name"] || "x") : (d.labels[xKey] ?? "x"),
    xUnit: xKey == null ? String(meta["x_column_unit"] ?? "") : (d.units[xKey] ?? ""),
    yLabel: d.labels[yKey] ?? "y",
    yUnit: d.units[yKey] ?? "",
  };
}

const num = (v: number | null | undefined): number => (v == null ? Number.NaN : v);

/** True when the band came back empty (the fit had no usable covariance). */
export function bandIsEmpty(band: BandsResult): boolean {
  return !band.ciLo.some((v) => v != null && Number.isFinite(v));
}

/** Columns: data, fit, CI low, CI high, then PI low/high when `prediction`. */
export function bandDataStruct(rows: BandRows, band: BandsResult, prediction: boolean, src: BandSource): DataStruct {
  const lv = levelLabel(band.level);
  const labels = [src.yLabel || "y", `${src.model} fit`, `${lv} CI low`, `${lv} CI high`];
  if (prediction) labels.push(`${lv} PI low`, `${lv} PI high`);
  const values = rows.x.map((_, i) => {
    const row = [rows.y[i]!, num(band.yFit[i]), num(band.ciLo[i]), num(band.ciHi[i])];
    if (prediction) row.push(num(band.piLo[i]), num(band.piHi[i]));
    return row;
  });
  return {
    time: rows.x,
    values,
    labels,
    units: labels.map(() => src.yUnit),
    metadata: {
      x_column_long: src.xLabel,
      x_column_unit: src.xUnit,
      fitBand: {
        source: { id: src.datasetId, name: src.datasetName },
        model: src.model,
        level: band.level,
        prediction,
      },
    },
  };
}

/** The band plot's series styles, keyed by channel: data as markers, the fit
 *  and its band limits in one palette slot with the band filled between them
 *  (the prediction band in the next slot, dotted). */
export function bandStyles(prediction: boolean): Record<number, SeriesStyle> {
  const styles: Record<number, SeriesStyle> = {
    0: { width: 0, marker: true },
    1: { color: "--series-2" },
    2: { color: "--series-2", width: 1, line: "dashed", fill: { vs: 3 } },
    3: { color: "--series-2", width: 1, line: "dashed" },
  };
  if (prediction) {
    styles[4] = { color: "--series-3", width: 1, line: "dotted", fill: { vs: 5 } };
    styles[5] = { color: "--series-3", width: 1, line: "dotted" };
  }
  return styles;
}

// ── the band on the MAIN graph (FitOverlay.band) ─────────────────────────────
// The fit overlay is a full-row column (null where the fit has no value:
// excluded/gap rows), so the band is evaluated at exactly the rows that carry
// a fitted value, at their plotted x, and laid back onto the same full-row
// length — it then aligns with the curve however the plot trims or masks it.

/** Rows of `overlay` that carry a fitted value, and their x from `xs`. */
export function overlayRows(overlay: FitOverlay, xs: readonly number[]): { idx: number[]; x: number[] } {
  const idx: number[] = [];
  overlay.y.forEach((v, i) => {
    if (v != null && Number.isFinite(xs[i])) idx.push(i);
  });
  return { idx, x: idx.map((i) => xs[i]!) };
}

/** The band columns for `overlay`, full-row length, from `band` values
 *  starting at `offset` (the rows were appended after the band-plot grid). */
export function overlayBand(
  overlay: FitOverlay,
  idx: readonly number[],
  band: BandsResult,
  offset: number,
  prediction: boolean,
): NonNullable<FitOverlay["band"]> {
  const col = (src: (number | null)[]) => {
    const out: (number | null)[] = overlay.y.map(() => null);
    idx.forEach((row, k) => {
      const v = src[offset + k];
      out[row] = v != null && Number.isFinite(v) ? v : null;
    });
    return out;
  };
  const lv = levelLabel(band.level);
  // One legend entry per band, on its lower edge (lib/fitBandOverlay.ts).
  const edges = [
    { label: `${lv} CI low`, y: col(band.ciLo), legend: `${lv} confidence band` },
    { label: `${lv} CI high`, y: col(band.ciHi), legend: "" },
  ];
  if (prediction) {
    edges.push(
      { label: `${lv} PI low`, y: col(band.piLo), legend: `${lv} prediction band` },
      { label: `${lv} PI high`, y: col(band.piHi), legend: "" },
    );
  }
  return edges;
}
