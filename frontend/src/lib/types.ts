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
  /** `axis` = 0 (primary/left Y) or 1 (secondary/right Y) for the dual-Y feature. */
  series: { label: string; unit: string; axis?: number }[];
  x: { label: string; unit: string; log: boolean };
  y: { log: boolean };
}

/** Response of POST /api/plot/map — a regular grid for the 2-D heatmap.
 *  `z_grid` is row-major `[ny][nx]` (null = NaN, i.e. outside the data hull);
 *  cell `z_grid[j][i]` sits at `(x_axis[i], y_axis[j])`. */
export interface MapResponse {
  x_axis: number[];
  y_axis: number[];
  z_grid: (number | null)[][];
  x: { label: string; unit: string };
  y: { label: string; unit: string };
  z: { label: string; unit: string; min: number | null; max: number | null };
}

/** One peak from POST /api/rsm/analyze. Centres/FWHM are `[omega, 2theta]` in
 *  angle space and `[Qx, Qz]` in reciprocal space (null when no Q-space). */
export interface RsmPeak {
  rank: number;
  centre_angle: [number, number];
  centre_Q: [number | null, number | null];
  fwhm_angle: [number, number];
  fwhm_Q: [number | null, number | null];
  amplitude: number;
  background: number;
  classification: string; // "substrate" | "film" | "unknown"
}

/** Response of POST /api/rsm/analyze. */
export interface RsmAnalysisResponse {
  peaks: RsmPeak[];
  n_peaks_found: number;
  intensity_unit: string;
  used_q_space: boolean;
}

/** Response of POST /api/rsm/strain (NaN fields serialize as null). */
export interface RsmStrainResponse {
  eps_parallel: number | null;
  eps_perp: number | null;
  a_sub_parallel: number;
  a_sub_perp: number;
  a_film_parallel: number;
  a_film_perp: number;
  relaxation: number | null;
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
  /** Reference-background subtraction folded into `corrections`: the picked
   *  background dataset's id + the interpolation method. Persisted so the
   *  Corrections card can re-populate and re-apply it reproducibly. */
  bgRef?: { datasetId: string; interp: string };
  /** Free-text user notes about this dataset (sample, conditions, caveats).
   *  Shown in the Inspector Notes card; round-trips through the .dwk workspace. */
  notes?: string;
  /** User tags for organizing + filtering the Library (e.g. "MvsH", "sample-A").
   *  Round-trips through the .dwk workspace. */
  tags?: string[];
  /** Optional group name; the Library renders collapsible sections by group
   *  (ungrouped datasets fall under "Ungrouped"). Round-trips through .dwk. */
  group?: string;
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

/** An estimated baseline to overlay as a line, aligned 1:1 with the dataset's
 *  plotted x. Tagged with the source dataset (drops out when stale/mismatched). */
export interface BaselineOverlay {
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

/** One fitted peak (from /api/peaks/fit-multi, or mapped from /api/peaks/fit).
 *  `eta` is null for non-pseudo-Voigt models (NaN serialized at the wire). */
export interface FittedPeak {
  center: number;
  fwhm: number;
  height: number;
  bg: number;
  eta: number | null;
  area: number;
  status: string;
  model: string;
  [key: string]: unknown;
}

/** Result of a simultaneous multi-peak fit (/api/peaks/fit-multi). `R2`/`rmse`
 *  are NaN-serialized to null when synthesized from independent per-peak fits. */
export interface MultiFitResult {
  peaks: FittedPeak[];
  bgCoeffs: number[];
  R2: number | null;
  rmse: number | null;
  nPeaks: number;
  model: string;
}

/** Result of a single-peak window fit (/api/peaks/fit). */
export interface SinglePeakFit {
  success: boolean;
  reason: string;
  center: number;
  fwhm: number;
  height: number;
  bg: number;
  eta: number | null;
  area: number;
  params: number[];
  model: string;
  window: number[];
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

/** A reference line drawn across the plot at a fixed X or Y value (mark Hc, Tc,
 *  zero, a critical edge…). Rendered by the uPlot refLinePlugin. */
export interface RefLine {
  id: string;
  axis: "x" | "y";
  value: number;
}

/** Per-channel line style (solid/dashed/dotted) — maps to a uPlot dash array. */
export type LineStyle = "solid" | "dashed" | "dotted";

/** A non-data column role (W5 DataWorkspace column roles). A channel with a role
 *  is excluded from the plot. `label` keeps it in the worksheet + its statistics
 *  (a descriptor column you tabulate but don't curve); `ignore` additionally
 *  drops it from the worksheet statistics (out of analysis). Absent = "data". */
export type ChannelRole = "label" | "ignore";

/** A text annotation pinned at a data coordinate (label a peak, a feature, a
 *  transition…). Drawn by the uPlot annotationPlugin as a dot + label. */
export interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** Axis tick number format. `auto` = uPlot's default; `fixed` = `toFixed(digits)`;
 *  `sci` = `toExponential(digits)`. `digits` is the decimal/mantissa count. */
export type TickMode = "auto" | "fixed" | "sci";

export interface AxisFormat {
  mode: TickMode;
  digits: number;
}

/** A per-channel styling override for the plot. Keyed in the store by the
 *  dataset *channel index* (stable across show/hide). Any field left unset
 *  falls back to the default (palette color by display position, 1.5 px,
 *  solid). `color` is either a token name (`"--series-3"`, re-themeable) or a
 *  literal hex (`"#ff8800"`, from the custom picker). */
export interface SeriesStyle {
  color?: string;
  width?: number;
  line?: LineStyle;
  marker?: boolean; // draw circular markers at each data point
  markerSize?: number; // marker diameter in px (default 5); only when marker
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
