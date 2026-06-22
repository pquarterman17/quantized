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

/** A dataset held client-side: the parsed DataStruct + a stable id + name.
 *  `raw` is the pristine import; `data` is the currently displayed (corrected)
 *  view. `corrections` are the params that produced `data` from `raw`. */
export interface Dataset {
  id: string;
  name: string;
  data: DataStruct;
  raw?: DataStruct;
  corrections?: CorrectionParams;
}

/** Correction-pipeline params (camelCase wire keys; all optional).
 *  Mirrors `routes/corrections.CorrectionParams` / MATLAB `correctionParams`. */
export interface CorrectionParams {
  xOff?: number;
  yOff?: number;
  bgSlope?: number;
  bgInt?: number;
  bgPoly?: number[];
  xTrimMin?: number;
  xTrimMax?: number;
  isNeutron?: boolean;
  isMag?: boolean;
  fieldUnit?: string;
  momentUnit?: string;
  sampleMass?: number;
  sampleVolume?: number;
  smoothEnabled?: boolean;
  smoothWindow?: number;
  smoothMethod?: string;
  normMethod?: string;
  derivativeMode?: string;
}
