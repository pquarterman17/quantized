// Curve Fit — the confidence/prediction band as a library dataset. Pure: no
// React, no store.
//
// Why a dataset and not a live-plot overlay: the fit overlay (store
// `fitOverlay`) is a screen-only extra series and never reaches the vector
// export, while a dataset channel styled `fill: {vs}` (MAIN #13) is drawn as
// a native uPlot band on screen AND as `fill_between` in the export. So the
// band plot carries the data, the fit and the band limits as channels, the
// same way the reflectivity workshop's DREAM bands do (reflDreamBands.ts).
//
// Rows: every fitted point plus an even grid across the fitted x-range,
// sorted by x, so the band is smooth even for sparse data. The data column is
// NaN on the grid rows (drawn as markers only, so the gaps never show).

import type { BandsResult } from "../../../lib/api/fitStats";
import type { DataStruct, Dataset, SeriesStyle } from "../../../lib/types";

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
