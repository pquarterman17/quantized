// Wire types mirroring the FastAPI backend payloads (src/quantized/routes).

/** DataStruct as serialized by `datastruct_payload` / `DataStruct.to_dict`. */
export interface DataStruct {
  time: number[];
  values: number[][]; // row-major: values[row][channel]
  labels: string[];
  units: string[];
  metadata: Record<string, unknown>;
}

/** Response of POST /api/plot/series — uPlot-ready column data. */
export interface PlotSeriesResponse {
  /** Column-oriented: [xValues, series1Values, series2Values, ...] (null = NaN). */
  data: (number | null)[][];
  series: { label: string; unit: string }[];
  x: { label: string; unit: string; log: boolean };
  y: { log: boolean };
}

/** A dataset held client-side: the parsed DataStruct + a stable id + name. */
export interface Dataset {
  id: string;
  name: string;
  data: DataStruct;
}
