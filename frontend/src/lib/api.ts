// Typed fetch layer over the FastAPI backend. All endpoints are under /api
// (dev: Vite proxies to uvicorn :8000; prod: same-origin static mount).

import { postDownload } from "./download";
import type { ExportSeriesStyle } from "./exportStyles";
import type {
  CalcResult,
  CorrectionParams,
  DataStruct,
  ElementInfo,
  FitModel,
  MapResponse,
  MultiFitResult,
  Peak,
  PlotSeriesResponse,
  RsmAnalysisResponse,
  RsmStrainResponse,
  SinglePeakFit,
  SldPreset,
} from "./types";

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function getJSON<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path));
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function health(): Promise<{ status: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as { status: string };
}

/** Import a local file path (auto-detect format) → DataStruct. */
export function importFile(path: string): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/parsers/import", { path });
}

/** Upload a file's bytes from the browser (file-picker / drag-drop) → DataStruct. */
export async function uploadFile(file: File): Promise<DataStruct> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/parsers/upload", { method: "POST", body: form });
  return unwrap<DataStruct>(res);
}

export interface PlotRequest {
  dataset: DataStruct;
  x_key?: number | string | null;
  y_keys?: (number | string)[] | null;
  y2_keys?: (number | string)[] | null;
  x_log?: boolean;
  y_log?: boolean;
}

/** Build uPlot-ready series from a DataStruct + selection. */
export function plotSeries(req: PlotRequest): Promise<PlotSeriesResponse> {
  return postJSON<PlotSeriesResponse>("/api/plot/series", req);
}

export interface MapRequest {
  dataset: DataStruct;
  x_key: number | string;
  y_key: number | string;
  z_key: number | string;
  method?: string;
  nx?: number;
  ny?: number;
}

/** Regrid 3 scattered channels (x, y, z) of a DataStruct into a heatmap grid. */
export function mapSeries(req: MapRequest): Promise<MapResponse> {
  return postJSON<MapResponse>("/api/plot/map", req);
}

// ── RSM (reciprocal-space maps) ───────────────────────────────────────────────
/** Find + fit peaks in a 2D RSM dataset (centres/FWHM in angle + Q-space). */
export function analyzeRsm(body: {
  dataset: DataStruct;
  n_peaks?: number;
  threshold?: number;
  smooth_sigma?: number;
  min_separation?: number;
  fit_window?: number;
  fit_model?: string;
}): Promise<RsmAnalysisResponse> {
  return postJSON("/api/rsm/analyze", body);
}

/** Strain + relaxation from substrate/film reciprocal-space peak centres. */
export function rsmStrain(body: {
  q_sub: [number, number];
  q_film: [number, number];
  bulk?: [number, number] | null;
}): Promise<RsmStrainResponse> {
  return postJSON("/api/rsm/strain", body);
}

export interface CorrectionsRequest {
  dataset: DataStruct;
  params: CorrectionParams;
  bg_dataset?: DataStruct | null;
  bg_interp?: string;
}

/** Apply the correction pipeline to a DataStruct → corrected DataStruct. */
export function applyCorrections(req: CorrectionsRequest): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/corrections/apply", req);
}

// ── Fitting ─────────────────────────────────────────────────────────────────
export interface FitRequest {
  model: string;
  x: number[];
  y: number[];
  p0?: number[];
  lower?: number[];
  upper?: number[];
  weights?: number[];
  fixed?: boolean[];
  calc_errors?: boolean;
}

/** Registry of fit models with parameter names and defaults. */
export function listFitModels(): Promise<{ models: FitModel[] }> {
  return getJSON("/api/fitting/models");
}

/** Initial-parameter guess for a named model given (x, y). */
export function autoGuess(model: string, x: number[], y: number[]): Promise<{ p0: number[] }> {
  return postJSON("/api/fitting/autoguess", { model, x, y });
}

/** Bounded nonlinear least-squares fit of a named model. */
export function fitModel(req: FitRequest): Promise<CalcResult> {
  return postJSON("/api/fitting/fit", req);
}

// ── Baseline ────────────────────────────────────────────────────────────────
type BaselineResult = { baseline: (number | null)[] };
type BaselineWithInfo = BaselineResult & { info: CalcResult };

export function baselineEstimate(body: {
  x: number[];
  y: number[];
  method?: string;
}): Promise<BaselineResult> {
  return postJSON("/api/baseline/estimate", body);
}

export function baselineALS(body: {
  y: number[];
  lam?: number;
  p?: number;
}): Promise<BaselineResult> {
  return postJSON("/api/baseline/als", body);
}

export function baselineRollingBall(body: {
  y: number[];
  radius?: number;
  smooth?: number;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/rollingball", body);
}

export function baselineModPoly(body: {
  y: number[];
  order?: number;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/modpoly", body);
}

/** Fit a polynomial background from a boxed x/y region (BosonPlotter "Fit BG
 *  from Box"); returns the full-range background + coeffs + region stats. */
export function baselineRegion(body: {
  x: number[];
  y: number[];
  x_min: number;
  x_max: number;
  y_min?: number | null;
  y_max?: number | null;
  order?: number;
}): Promise<{
  background: (number | null)[];
  coeffs: number[];
  n_points: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  order: number;
}> {
  return postJSON("/api/baseline/region", body);
}

// ── Stats ───────────────────────────────────────────────────────────────────
export function statsDescriptive(x: number[]): Promise<CalcResult> {
  return postJSON("/api/stats/descriptive", { x });
}

export function statsRegression(body: {
  x: number[];
  y: number[];
  order?: number;
  alpha?: number;
}): Promise<CalcResult> {
  return postJSON("/api/stats/regression", body);
}

export function statsTTest(body: {
  x: number[];
  y?: number[];
  mu?: number;
  paired?: boolean;
  tail?: string;
}): Promise<CalcResult> {
  return postJSON("/api/stats/ttest", body);
}

export function statsAnova(groups: number[][]): Promise<CalcResult> {
  return postJSON("/api/stats/anova", { groups });
}

export function statsPCA(body: {
  data: number[][];
  center?: boolean;
  scale?: boolean;
}): Promise<CalcResult> {
  return postJSON("/api/stats/pca", body);
}

// ── Reference data ──────────────────────────────────────────────────────────
export function getConstants(): Promise<{ constants: Record<string, number> }> {
  return getJSON("/api/reference/constants");
}

export function getElements(): Promise<{ elements: ElementInfo[] }> {
  return getJSON("/api/reference/elements");
}

export function getElement(symbol: string): Promise<ElementInfo> {
  return getJSON(`/api/reference/elements/${encodeURIComponent(symbol)}`);
}

export function convertUnits(
  value: number | number[],
  from: string,
  to: string,
): Promise<{ result: number | (number | null)[]; info: CalcResult }> {
  return postJSON("/api/reference/convert", { value, from, to });
}

/** Bragg / Q↔2θ scalar conversion (calc.xray). `mode` selects the quantity. */
export function xrayCalc(
  mode: string,
  wavelength: number,
  value: number,
  n = 1,
): Promise<{ result: number; unit: string; description: string }> {
  return postJSON("/api/xray/calc", { mode, wavelength, value, n });
}

/** Interplanar d-spacing from lattice params + Miller indices (calc.crystallography). */
export function crystalDSpacing(body: {
  system: string;
  a: number;
  b: number;
  c: number;
  h: number;
  k: number;
  l: number;
}): Promise<{ d: number; system: string }> {
  return postJSON("/api/crystallography/dspacing", body);
}

// ── Export (file downloads) ─────────────────────────────────────────────────
/** Export XRD data as CSV / Origin ASCII; triggers a browser download. */
export function exportXrdCsv(body: {
  dataset: DataStruct;
  fmt?: string;
  intensity?: string;
  include_metadata?: boolean;
  filename?: string;
}): Promise<void> {
  return postDownload("/api/export/xrd-csv", body, "export.csv");
}

/** Export a DataStruct (+ optional corrected view) as a self-describing HDF5
 *  file; triggers a browser download. */
export function exportHdf5(body: {
  dataset: DataStruct;
  corrected?: DataStruct | null;
  filename?: string;
}): Promise<void> {
  return postDownload("/api/export/hdf5", body, "export.h5");
}

/** Export a DataStruct as an Origin LabTalk .ogs script + CSV (zipped). */
export function exportOrigin(body: {
  dataset: DataStruct;
  filename?: string;
  log_x?: boolean;
  log_y?: boolean;
  make_graph?: boolean;
}): Promise<void> {
  return postDownload("/api/export/origin", body, "export.zip");
}

/** Export several datasets side-by-side into one role-based CSV. */
export function exportConsolidated(body: {
  datasets: { dataset: DataStruct; name: string }[];
  fmt?: string;
  filename?: string;
}): Promise<void> {
  return postDownload("/api/export/consolidated", body, "consolidated.csv");
}

/** Render a publication figure server-side (matplotlib) and download it. */
export function exportFigure(body: {
  dataset: DataStruct;
  y_keys?: (number | string)[];
  x_log?: boolean;
  y_log?: boolean;
  fmt?: string;
  style?: string;
  dpi?: number;
  title?: string;
  x_label?: string;
  y_label?: string;
  series_styles?: (ExportSeriesStyle | null)[];
  filename?: string;
}): Promise<void> {
  return postDownload("/api/export/figure", body, `figure.${body.fmt ?? "pdf"}`);
}

// ── Magnetometry ────────────────────────────────────────────────────────────
/** Analyze an M-H loop -> Hc / Mr / Ms / squareness / loop area / SFD. */
export function hysteresisAnalysis(body: {
  h: number[];
  m: number[];
  saturation_fraction?: number;
  pre_smooth?: number;
  virgin_detect?: boolean;
}): Promise<CalcResult> {
  return postJSON("/api/magnetometry/hysteresis", body);
}

/** Subtract a linear high-T background from M(T) -> corrected moment + fit. */
export function subtractMagBackground(body: {
  temperature: number[];
  moment: number[];
  fit_range?: [number, number] | null;
  auto_fraction?: number;
}): Promise<{ corrected: (number | null)[]; slope: number; intercept: number }> {
  return postJSON("/api/magnetometry/subtract-background", body);
}

/** Convert field (x) + moment (y) units, sample-aware (emu→emu/g needs mass). */
export function convertMagUnits(body: {
  x: number[];
  y: number[];
  from_field?: string;
  to_field?: string;
  from_moment?: string;
  to_moment?: string;
  sample_mass?: number;
  sample_volume?: number;
}): Promise<{
  x: (number | null)[];
  y: (number | null)[];
  x_unit: string;
  y_unit: string;
  warning: string;
}> {
  return postJSON("/api/magnetometry/convert-units", body);
}

// ── Peaks ───────────────────────────────────────────────────────────────────
/** Robust peak detection -> peak list + estimated background. */
export function findPeaks(body: {
  x: number[];
  y: number[];
  snr_threshold?: number;
  min_prominence?: number;
  max_peaks?: number;
  sensitivity?: string;
}): Promise<{ peaks: Peak[]; background: (number | null)[] }> {
  return postJSON("/api/peaks/find", body);
}

/** Seed for a peak fit — center/FWHM/height (+ optional eta for pseudo-Voigt). */
export interface PeakSeed {
  center: number;
  fwhm: number;
  height: number;
  eta?: number;
}

/** Fit one peak in a window to a named shape (/api/peaks/fit). */
export function fitPeak(body: {
  x: number[];
  y: number[];
  x_lo: number;
  x_hi: number;
  seed_center: number;
  seed_fwhm?: number;
  model?: string;
}): Promise<SinglePeakFit> {
  return postJSON("/api/peaks/fit", body);
}

/** Fit all peaks + a polynomial background simultaneously (/api/peaks/fit-multi). */
export function fitMultiPeak(body: {
  x: number[];
  y: number[];
  peaks: PeakSeed[];
  model?: string;
  bg_degree?: number;
  constrain?: boolean;
  link_mode?: string;
}): Promise<MultiFitResult> {
  return postJSON("/api/peaks/fit-multi", body);
}

// ── Reflectivity ──────────────────────────────────────────────────────────────
/** Material SLD presets for building reflectivity models. */
export function reflPresets(): Promise<{ presets: SldPreset[] }> {
  return getJSON("/api/reflectivity/presets");
}

/** A layer row: [thickness Å, SLD_real Å⁻², SLD_imag Å⁻², roughness Å]. */
export type ReflLayer = [number, number, number, number];

/** Simulate specular reflectivity R(Q) from a layer stack (Parratt recursion). */
export function reflSimulate(body: {
  layers: ReflLayer[];
  q_min?: number;
  q_max?: number;
  n_points?: number;
  roughness?: boolean;
  scale?: number;
  background?: number;
  resolution?: number | null;
}): Promise<{ q: number[]; r: (number | null)[] }> {
  return postJSON("/api/reflectivity/simulate", body);
}

/** Compute the SLD(z) depth profile for a layer stack (error-function interfaces). */
export function reflSldProfile(body: {
  layers: ReflLayer[];
  n_points?: number;
  padding?: number;
}): Promise<{ z: number[]; sld: (number | null)[] }> {
  return postJSON("/api/reflectivity/sld-profile", body);
}
