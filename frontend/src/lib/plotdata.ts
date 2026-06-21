// Bridge a DataStruct to uPlot AlignedData. Primary path hits the backend
// /api/plot/series route; a pure client-side builder is the offline fallback
// (and what the unit tests exercise).

import type uPlot from "uplot";

import { plotSeries } from "./api";
import type { DataStruct, PlotSeriesResponse } from "./types";

export interface PlotPayload {
  data: uPlot.AlignedData;
  series: { label: string; unit: string }[];
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

/** Fetch plot series from the backend; fall back to client packing offline. */
export async function fetchPlot(ds: DataStruct, yLog: boolean): Promise<PlotPayload> {
  try {
    const r = await plotSeries({ dataset: ds, y_log: yLog });
    return fromResponse(r);
  } catch {
    return buildColumns(ds);
  }
}
