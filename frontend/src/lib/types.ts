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

/** A registered fit model's metadata (from GET /api/fitting/models). */
export interface FitModel {
  name: string;
  category: string;
  paramNames: string[];
  nParams: number;
  p0: number[];
  lb: (number | null)[];
  ub: (number | null)[];
}

/** Loose result dict from a calc route (fit result, stats, info, …). Keys are
 *  documented per endpoint; values may be scalars, arrays, or null (NaN/Inf). */
export type CalcResult = Record<string, unknown>;

/** A fit curve to overlay on the plot, tagged with the dataset it was fit to
 *  (so it only renders while that dataset is active). `y` aligns to the
 *  dataset's plotted x (null = gap). */
export interface FitOverlay {
  datasetId: string;
  y: (number | null)[];
}

/** Peak markers to overlay (points only). `y` is sparse — null except at the
 *  data points nearest each peak center. Tagged with the source dataset. */
export interface PeakOverlay {
  datasetId: string;
  y: (number | null)[];
}

/** One detected peak (from /api/peaks/find). */
export interface Peak {
  center: number;
  height: number;
  fwhm: number;
  prominence: number;
  localSNR: number;
  area: number | null;
  [key: string]: unknown;
}

/** One material SLD preset (from GET /api/reflectivity/presets). `sldX` is the
 *  X-ray SLD (Å⁻²), `sldN` the neutron SLD, `sldImag` the X-ray imaginary part. */
export interface SldPreset {
  name: string;
  formula: string;
  sldX: number;
  sldN: number;
  sldImag: number;
  density: number;
  [key: string]: unknown;
}

/** One element row from the reference table. */
export interface ElementInfo {
  Z: number;
  symbol: string;
  name: string;
  [key: string]: unknown;
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
