// Bridge a DataStruct to uPlot AlignedData. Primary path hits the backend
// /api/plot/series route; a pure client-side builder is the offline fallback
// (and what the unit tests exercise).

import type uPlot from "uplot";

import { plotSeries } from "./api";
import type {
  BaselineOverlay,
  DataStruct,
  FitOverlay,
  PeakOverlay,
  PlotSeriesResponse,
} from "./types";

export interface PlotSeriesSpec {
  label: string;
  unit: string;
  /** "points" renders markers only (peak overlay); default is a line. */
  kind?: "line" | "points";
}

export interface PlotPayload {
  data: uPlot.AlignedData;
  series: PlotSeriesSpec[];
  xLabel: string;
  xUnit: string;
}

/** Pure client-side column packing (x = time, all value channels). */
export function buildColumns(ds: DataStruct): PlotPayload {
  const x = ds.time.map((v) => (Number.isFinite(v) ? v : null));
  const nCh = ds.labels.length;
  const cols: (number | null)[][] = [x];
  for (let c = 0; c < nCh; c++) {
    cols.push(ds.values.map((row) => (Number.isFinite(row[c]) ? row[c] : null)));
  }
  return {
    data: cols as uPlot.AlignedData,
    series: ds.labels.map((label, i) => ({ label, unit: ds.units[i] ?? "" })),
    xLabel: String(ds.metadata?.["x_column_name"] ?? "x"),
    xUnit: String(ds.metadata?.["x_column_unit"] ?? ""),
  };
}

function fromResponse(r: PlotSeriesResponse): PlotPayload {
  return {
    data: r.data as uPlot.AlignedData,
    series: r.series,
    xLabel: r.x.label,
    xUnit: r.x.unit,
  };
}

/** Append a fit curve as an extra series, but only when the overlay belongs to
 *  the active dataset and aligns to the plotted x (same point count). Otherwise
 *  return the payload unchanged — a stale/mismatched fit silently drops out. */
export function withFitOverlay(
  payload: PlotPayload,
  overlay: FitOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  if (overlay.y.length !== payload.data[0].length) return payload;
  return {
    ...payload,
    data: [...payload.data, overlay.y] as uPlot.AlignedData,
    series: [...payload.series, { label: "fit", unit: "" }],
  };
}

/** Build a sparse y-column (null everywhere except the data point nearest each
 *  peak center, set to its height) so peaks render as markers on the shared x. */
export function peakOverlayArray(
  time: number[],
  peaks: { center: number; height: number }[],
): (number | null)[] {
  const y: (number | null)[] = new Array(time.length).fill(null);
  for (const p of peaks) {
    if (!Number.isFinite(p.center)) continue;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < time.length; i++) {
      const d = Math.abs(time[i] - p.center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    y[best] = p.height;
  }
  return y;
}

/** Append an estimated baseline as an extra line series (same guards as
 *  withFitOverlay: must belong to the active dataset and align to the x). */
export function withBaselineOverlay(
  payload: PlotPayload,
  overlay: BaselineOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  if (overlay.y.length !== payload.data[0].length) return payload;
  return {
    ...payload,
    data: [...payload.data, overlay.y] as uPlot.AlignedData,
    series: [...payload.series, { label: "baseline", unit: "" }],
  };
}

/** Append peak markers as a points-only series (same guards as withFitOverlay). */
export function withPeakOverlay(
  payload: PlotPayload,
  overlay: PeakOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  if (overlay.y.length !== payload.data[0].length) return payload;
  return {
    ...payload,
    data: [...payload.data, overlay.y] as uPlot.AlignedData,
    series: [...payload.series, { label: "peaks", unit: "", kind: "points" }],
  };
}

/** Fetch plot series from the backend; fall back to client packing offline. */
export async function fetchPlot(
  ds: DataStruct,
  yLog: boolean,
  xLog = false,
  yKeys: number[] | null = null,
): Promise<PlotPayload> {
  try {
    const r = await plotSeries({
      dataset: ds,
      y_log: yLog,
      x_log: xLog,
      y_keys: yKeys ?? undefined,
    });
    return fromResponse(r);
  } catch {
    return buildColumns(ds);
  }
}
