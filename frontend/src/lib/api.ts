// Typed fetch layer over the FastAPI backend. All endpoints are under /api
// (dev: Vite proxies to uvicorn :8000; prod: same-origin static mount).

import type { SubstrateInfo } from "../components/workshops/calculators/SubstratesTab";
import { postDownload } from "./download";
import type { ExportSeriesStyle } from "./exportStyles";
import type { FigureOverrides } from "./figureOverrides";
import type { FigureHitmap } from "./previewmap";
import type { ReportSheet } from "./report";
import type { Recommendation } from "./statschooser";
import type {
  BookSource,
  CalcResult,
  CorrectionParams,
  DataStruct,
  ElementInfo,
  FitModel,
  ImportFilterWire,
  ImportPreviewResponse,
  ImportSettingsWire,
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

async function deleteJSON<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path, { method: "DELETE" }));
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

/** Fetch one Origin book's full data (ORIGIN_FILE_DECODE_PLAN #38 — the lazy
 *  per-book import transport's on-demand fetch): `POST /api/parsers/books/data`
 *  with `source`'s project-level reference (path or upload token) plus the
 *  book's own id. Called by `useApp.ensureBookData` the first time a pending
 *  Dataset is actually shown (activated, bound into a plot window/panel, or
 *  opened in the worksheet) — never eagerly for every book at import time. */
export function fetchBookData(source: BookSource): Promise<DataStruct> {
  // Mirrors quantized.routes.books.BookDataRequest exactly (book_id + EITHER
  // path OR token) — `kind`/`rows`/`cols` are frontend-only bookkeeping, not
  // sent.
  return postJSON<DataStruct>("/api/parsers/books/data", {
    book_id: source.bookId,
    ...(source.kind === "path" ? { path: source.path } : { token: source.token }),
  });
}

/** The bundled first-run demo dataset (a synthetic VSM-like hysteresis loop,
 *  `GET /api/samples/demo`) — the real packaged sample, parsed server-side
 *  through the ordinary `import_auto` path, as opposed to the purely
 *  client-side `makeDemoDataset()` fallback used when offline. */
export function fetchDemoSample(): Promise<DataStruct> {
  return getJSON<DataStruct>("/api/samples/demo");
}

/** Best-effort starting import settings for raw text (delimiter, header/units
 *  lines, column roles) — the same guesser behind the import wizard's first
 *  render (`io.import_preview.guess_settings`). Used by clipboard paste
 *  (gap #47) so pasted text imports through the one shared text-import engine
 *  instead of a second parser. */
export function guessImportSettings(text: string): Promise<Record<string, unknown>> {
  return postJSON<Record<string, unknown>>("/api/import/guess", { text });
}

/** Parse raw text under `settings` (from `guessImportSettings`, or a caller's
 *  own tweak of it) into a DataStruct — the import wizard's "confirm" step. */
export function parseImportText(
  text: string,
  settings: Record<string, unknown>,
): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/import/parse", { text, settings });
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

export interface BootstrapRequest {
  model: string;
  x: number[];
  y: number[];
  p0: number[];
  n_boot?: number;
  method?: string;
  seed?: number;
  alpha?: number;
  lower?: number[];
  upper?: number[];
  /** Opt-in (gap #29): also return the full replicate matrix as
   *  `boot_samples` ([n_kept x P]) — the corner-plot source. */
  return_samples?: boolean;
}

export interface BootstrapResult {
  params: number[];
  boot_mean: number[];
  boot_se: number[];
  ciLow: number[];
  ciHigh: number[];
  n_boot: number;
  n_failed: number;
  /** Present only when `return_samples: true` was posted. */
  boot_samples?: number[][];
  [key: string]: unknown;
}

/** Bootstrap parameter uncertainty (percentile CIs) for a named model fit;
 *  pass `return_samples: true` to also get the replicate matrix for a
 *  corner (pairs) plot — the uncertainty-quantification counterpart to
 *  `fitModel` (gap #29). */
export function bootstrapFit(req: BootstrapRequest): Promise<BootstrapResult> {
  return postJSON("/api/fitting/bootstrap", req);
}

// ── Custom equation models (GOTO #1) ────────────────────────────────────────
export interface EquationValidateResult {
  ok: boolean;
  params: string[];
  error?: string;
}

/** Validate a custom fit equation. Always 200 with ok/params/error — the
 *  live-validation shape (the fit endpoint is the one that 422s). */
export function validateEquation(equation: string): Promise<EquationValidateResult> {
  return postJSON("/api/fitting/equation/validate", { equation });
}

export interface EquationFitRequest {
  equation: string;
  x: number[];
  y: number[];
  guesses?: number[];
  /** Per-parameter bounds; null entries = unbounded on that side. */
  lower?: (number | null)[];
  upper?: (number | null)[];
  weights?: number[];
  calc_errors?: boolean;
}

/** Fit a custom equation model — the SAME result shape as `fitModel`
 *  (params/errors/R2/chiSqRed/RMSE/AIC/yFit) plus `paramNames`, so the
 *  standard fit-stats display works unchanged. */
export function fitEquation(req: EquationFitRequest): Promise<CalcResult> {
  return postJSON("/api/fitting/equation/fit", req);
}

// ── AICc model quick-scan (GOTO #6) ─────────────────────────────────────────
export interface ScanEquationCandidate {
  name: string;
  equation: string;
  guesses?: number[];
}

/** One ranked scan entry; a failed candidate has `error` set and null
 *  metrics (it still appears — a model that can't fit IS a scan result). */
export interface ScanEntry {
  name: string;
  kind: "registry" | "equation";
  error: string | null;
  k: number | null;
  params: number[] | null;
  paramNames: string[] | null;
  R2: number | null;
  RMSE: number | null;
  AIC: number | null;
  AICc: number | null;
  deltaAICc: number | null;
  weight: number | null;
}

export interface ScanResponse {
  n: number;
  nCandidates: number;
  results: ScanEntry[];
}

/** Fit all candidate models to (x, y) and rank by AICc. Omit `models` for
 *  the backend's default registry set (param count < n/3); saved custom
 *  equation models ride along in `equations`. */
export function scanFitModels(req: {
  x: number[];
  y: number[];
  dy?: number[];
  models?: string[];
  equations?: ScanEquationCandidate[];
}): Promise<ScanResponse> {
  return postJSON("/api/fitting/scan", req);
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

/** Histogram with a data-driven bin rule (`fd`/`sturges`/`scott`/…/int) and an
 *  optional distribution-fit overlay (scipy dist name). */
export function statsHistogram(
  data: number[],
  bins: string | number = "fd",
  fit?: string | null,
): Promise<CalcResult> {
  return postJSON("/api/statplots/histogram", { data, bins, ...(fit ? { fit } : {}) });
}

/** Shapiro-Wilk normality test (valid 3 ≤ n ≤ 5000). Returns W, p, N. */
export function statsShapiro(x: number[]): Promise<CalcResult> {
  return postJSON("/api/stats/shapiro", { x });
}

/** One family's MLE fit from /api/stats/fit-distribution — params, log-
 *  likelihood, AIC, and a KS goodness-of-fit test against the fitted curve. */
export interface DistFitResult {
  dist: string;
  params: Record<string, number>;
  loglike: number;
  aic: number;
  n_params: number;
  ks_d: number;
  ks_p: number;
  ks_p_approximate: boolean;
  N: number;
}

export interface DistFitAllResponse {
  fits: DistFitResult[];
  best: string;
  skipped: { dist: string; reason: string }[];
}

/** MLE-fit every curated family (ORIGIN_GAP #28: normal/lognormal/weibull/
 *  gamma/exponential), ranked by AIC ascending (`fits[0]` = `best`).
 *  Families whose support the data violates come back in `skipped`, not
 *  silently dropped. The Distribution workshop's fit-overlay picker (#52
 *  item 6b) — its first frontend consumer. */
export function statsFitDistributions(x: number[]): Promise<DistFitAllResponse> {
  return postJSON("/api/stats/fit-distribution", { x });
}

// ── Statistical plots — box / violin / Q-Q (gap #16, the StatStage) ────────
// Same request/response shapes as calc.statplots.{grouped_box_stats,
// violin_kde, qq_plot}; the interactive canvas (Stage/statRender.ts) and the
// matplotlib export (exportStatplotFigure below) both read these numbers, so
// on-screen and exported statistics always agree.

/** One group's box-and-whisker stats (matplotlib.cbook.boxplot_stats-compatible). */
export interface BoxStatWire {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  whislo: number;
  whishi: number;
  mean: number;
  n: number;
  fliers: number[];
  whis: number | string;
  label: string;
}

export interface BoxStatsResponse {
  boxes: BoxStatWire[];
  n_groups: number;
}

/** Box/whisker stats for one or more groups. */
export function statsBox(
  groups: number[][],
  labels?: string[] | null,
  whis: number | string = 1.5,
): Promise<BoxStatsResponse> {
  return postJSON("/api/statplots/box", { groups, labels, whis });
}

export interface ViolinResponse {
  x: number[];
  density: number[];
  bandwidth: number;
  quartiles: [number, number, number];
  n: number;
}

/** Gaussian-KDE density for a violin plot. */
export function statsViolin(
  data: number[],
  bwMethod: string | number = "scott",
  nPoints = 128,
  cut = 2.0,
): Promise<ViolinResponse> {
  return postJSON("/api/statplots/violin", { data, bw_method: bwMethod, n_points: nPoints, cut });
}

export interface QQResponse {
  theoretical_quantiles: number[];
  sample_quantiles: number[];
  slope: number;
  intercept: number;
  r_squared: number;
  dist: string;
  n: number;
}

/** Quantile-quantile / probability-plot coordinates against a distribution. */
export function statsQQ(data: number[], dist = "norm"): Promise<QQResponse> {
  return postJSON("/api/statplots/qq", { data, dist });
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

/** Interplanar d-spacing from lattice params + Miller indices (calc.crystallography).
 *  Angles (deg) default to 90 server-side; only the low-symmetry systems use them. */
export function crystalDSpacing(body: {
  system: string;
  a: number;
  b: number;
  c: number;
  h: number;
  k: number;
  l: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
}): Promise<{ d: number; system: string }> {
  return postJSON("/api/crystallography/dspacing", body);
}

/** Unit-cell volume (Å³) + optional molar mass & theoretical density from a
 *  chemical formula and Z (calc.crystallography + calc.formula). */
export function crystalCell(body: {
  a: number;
  b: number;
  c: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  formula?: string;
  z?: number;
}): Promise<{ volume: number; molar_mass?: number; density?: number }> {
  return postJSON("/api/crystallography/cell", body);
}

/** One probe's SLD block: real + imaginary (absorption) SLD in 10⁻⁶ Å⁻². */
export interface SldProbe {
  wavelength: number;
  sld_real: number;
  sld_imag: number;
  penetration: number; // 1/e depth, cm
  qc: number; // critical wavevector, 1/Å
  // neutron-only extras:
  incoherent?: number;
  xs_coherent?: number;
  xs_absorption?: number;
  xs_incoherent?: number;
}

export interface SldFormulaResult {
  formula: string;
  molar_mass: number;
  number_density: number;
  neutron: SldProbe;
  xray: SldProbe;
}

/** Neutron + X-ray SLD (real + imaginary/absorption) from a chemical formula,
 *  mass density, and probe wavelengths. Wraps NIST-NCNR-grade periodictable. */
export function sldFromFormula(body: {
  formula: string;
  density: number;
  neutron_wavelength?: number;
  xray_wavelength?: number;
}): Promise<SldFormulaResult> {
  return postJSON("/api/sld/formula", body);
}

// ── Electrical transport (calc.electrical) ──────────────────────────────────
/** ρ = R_s·t (Ω·cm). Thickness t in cm. */
export function electricalResistivity(rs: number, t: number): Promise<{ rho: number }> {
  return postJSON("/api/electrical/resistivity", { rs, t });
}

/** R_s = ρ/t (Ω/sq). */
export function electricalSheetResistance(rho: number, t: number): Promise<{ Rs: number }> {
  return postJSON("/api/electrical/sheet-resistance", { rho, t });
}

/** σ = 1/ρ (S/cm). */
export function electricalConductivity(rho: number): Promise<{ sigma: number }> {
  return postJSON("/api/electrical/conductivity", { rho });
}

/** μ = 1/(q·n·ρ) (cm²/V·s). */
export function electricalMobility(rho: number, n: number): Promise<{ mu: number }> {
  return postJSON("/api/electrical/mobility", { rho, n });
}

/** J = I/A (A/cm²). */
export function electricalCurrentDensity(i: number, area: number): Promise<{ J: number }> {
  return postJSON("/api/electrical/current-density", { i, area });
}

/** Single-point Hall: R_H (cm³/C), carrier density (cm⁻³), carrier type. */
export function electricalHall(
  vH: number,
  i: number,
  b: number,
  t: number,
): Promise<{ r_h: number; carrier_density: number; carrier_type: string }> {
  return postJSON("/api/electrical/hall", { v_h: vH, i, b, t });
}

// ── Optics (calc.optics) ────────────────────────────────────────────────────
/** Fresnel reflectance/transmittance at an interface (θ in degrees). */
export function opticsFresnel(
  n1: number,
  n2: number,
  theta: number,
): Promise<{ Rs: number; Rp: number; Ts: number; Tp: number }> {
  return postJSON("/api/optics/fresnel", { n1, n2, theta });
}

/** θ_c = arcsin(n₂/n₁) (deg); NaN when n₂ ≥ n₁ (no total internal reflection). */
export function opticsCriticalAngle(n1: number, n2: number): Promise<{ theta_c: number }> {
  return postJSON("/api/optics/critical-angle", { n1, n2 });
}

/** θ_B = arctan(n₂/n₁) (deg). */
export function opticsBrewsterAngle(n1: number, n2: number): Promise<{ theta_b: number }> {
  return postJSON("/api/optics/brewster-angle", { n1, n2 });
}

/** δ = λ/(4πk); depth in the wavelength's unit. */
export function opticsPenetrationDepth(
  n: number,
  k: number,
  wavelength: number,
): Promise<{ depth: number; abs_coeff: number; abs_length: number }> {
  return postJSON("/api/optics/penetration-depth", { n, k, wavelength });
}

/** δ = √(2ρ/(ωμ₀)); ρ in Ω·m (SI), f in Hz. */
export function opticsSkinDepth(
  rho: number,
  f: number,
): Promise<{ delta: number; delta_um: number; delta_nm: number }> {
  return postJSON("/api/optics/skin-depth", { rho, f });
}

/** (n, k) → (ε₁, ε₂): ε₁ = n²−k², ε₂ = 2nk. */
export function opticsRefractiveToDielectric(
  n: number,
  k: number,
): Promise<{ eps1: number; eps2: number }> {
  return postJSON("/api/optics/refractive-to-dielectric", { n, k });
}

/** (ε₁, ε₂) → (n, k) via the physical square root. */
export function opticsDielectricToRefractive(
  eps1: number,
  eps2: number,
): Promise<{ n: number; k: number }> {
  return postJSON("/api/optics/dielectric-to-refractive", { eps1, eps2 });
}

// ── Vacuum (calc.vacuum) ────────────────────────────────────────────────────
/** Mean free path λ = kT/(√2·π·d²·P) (m / mm / µm). P in Pa, T in K, d in m. */
export function vacuumMeanFreePath(
  p: number,
  temperature?: number,
  d?: number,
): Promise<{ mfp: number; mfpMm: number; mfpUm: number; P: number; T: number; d: number }> {
  return postJSON("/api/vacuum/mean-free-path", { p, temperature, d });
}

/** Monolayer formation time from impingement flux. P in Pa. */
export function vacuumMonolayerTime(
  p: number,
  m?: number,
  temperature?: number,
  aSite?: number,
): Promise<{ tMono: number; flux: number; P: number; T: number }> {
  return postJSON("/api/vacuum/monolayer-time", { p, m, temperature, a_site: aSite });
}

/** Knudsen number Kn = λ/L and the resulting flow regime. */
export function vacuumKnudsen(
  mfp: number,
  length: number,
): Promise<{ Kn: number; regime: string; mfp: number; L: number }> {
  return postJSON("/api/vacuum/knudsen", { mfp, length });
}

/** Pump-down time t = (V/S)·ln(P0/Pf). */
export function vacuumPumpDownTime(
  v: number,
  s: number,
  p0: number,
  pf: number,
): Promise<{
  time: number;
  timeMin: number;
  tau: number;
  V: number;
  S: number;
  P0: number;
  Pf: number;
}> {
  return postJSON("/api/vacuum/pump-down", { v, s, p0, pf });
}

/** Sputter yield (atoms/ion) for a material + ion at a given energy (eV). */
export function vacuumSputterYield(
  material: string,
  energy: number,
  ion?: string,
): Promise<{ Y: number; material: string; ion: string; energy: number }> {
  return postJSON("/api/vacuum/sputter-yield", { material, energy, ion });
}

/** Gas-flow conductance (molecular + viscous) and throughput. */
export function vacuumGasFlow(
  p1: number,
  p2: number,
  d: number,
  length: number,
  temperature?: number,
  m?: number,
): Promise<{ Cmol: number; Cvisc: number; throughput: number; Kn: number; regime: string }> {
  return postJSON("/api/vacuum/gas-flow", { p1, p2, d, length, temperature, m });
}

// ── Thermal (calc.thermal) ──────────────────────────────────────────────────
/** Wiedemann-Franz κ = L₀·σ·T (W/(m·K)). σ in S/cm, T in K. */
export function thermalWiedemannFranz(
  sigma: number,
  temperature: number,
): Promise<{ kappa: number; sigma: number; temperature: number; lorenz: number }> {
  return postJSON("/api/thermal/wiedemann-franz", { sigma, temperature });
}

/** Debye temperature Θ_D = (ħ/k_B)·v_s·(6π²·n)^(1/3) (K). v_s in m/s, n in m⁻³. */
export function thermalDebye(
  vS: number,
  n: number,
): Promise<{ theta_D: number; v_s: number; n: number }> {
  return postJSON("/api/thermal/debye", { v_s: vS, n });
}

/** Thermal diffusivity α = κ/(ρ·c_p) (m²/s). */
export function thermalDiffusivity(
  kappa: number,
  rho: number,
  cp: number,
): Promise<{ alpha: number; alpha_mm2: number; kappa: number; rho: number; cp: number }> {
  return postJSON("/api/thermal/diffusivity", { kappa, rho, cp });
}

// ── Diffusion (calc.diffusion) ──────────────────────────────────────────────
/** D = D₀·exp(−Ea/(k_B·T)) (cm²/s). D₀ in cm²/s, Ea in eV, T in K. */
export function diffusionArrhenius(
  d0: number,
  ea: number,
  t: number,
): Promise<{ D: number; D0: number; Ea: number; T: number }> {
  return postJSON("/api/diffusion/arrhenius", { d0, ea, t });
}

/** Diffusion length L = √(D·t) (cm / µm / nm). */
export function diffusionLength(
  d: number,
  t: number,
): Promise<{ L: number; L_um: number; L_nm: number; D: number; t: number }> {
  return postJSON("/api/diffusion/diffusion-length", { d, t });
}

/** Fick's first law J = −D·ΔC/Δx (atoms/(cm²·s)). */
export function diffusionFickFlux(
  d: number,
  dc: number,
  dx: number,
): Promise<{ J: number; J_abs: number; D: number; dC: number; dx: number }> {
  return postJSON("/api/diffusion/fick-flux", { d, dc, dx });
}

// ── Electrochemistry (calc.electrochemistry) ────────────────────────────────
/** Nernst potential E = E⁰ − (R·T)/(n·F)·ln(Q) (V). */
export function electrochemNernst(
  e0: number,
  n: number,
  q: number,
  t?: number,
): Promise<{ E: number; E0: number; n: number; Q: number; T: number }> {
  return postJSON("/api/electrochemistry/nernst", { e0, n, q, t });
}

/** Butler-Volmer current density (A/cm²). */
export function electrochemButlerVolmer(
  j0: number,
  eta: number,
  alpha?: number,
  t?: number,
): Promise<{ j: number; jAnodic: number; jCathodic: number; jTafel: number }> {
  return postJSON("/api/electrochemistry/butler-volmer", { j0, eta, alpha, t });
}

/** Tafel slope b = 2.303·R·T/(α·F) (V/decade, mV/decade). */
export function electrochemTafel(
  alpha: number,
  t?: number,
): Promise<{ b: number; bMv: number }> {
  return postJSON("/api/electrochemistry/tafel-slope", { alpha, t });
}

/** Ohmic (iR) drop V = I·R (V, mV). */
export function electrochemOhmicDrop(i: number, r: number): Promise<{ V: number; VmV: number }> {
  return postJSON("/api/electrochemistry/ohmic-drop", { i, r });
}

/** Double-layer capacitance C = ε₀·ε_r·A/d. d in nm, A in cm². */
export function electrochemDoubleLayer(
  epsilon: number,
  d: number,
  area: number,
): Promise<{ C: number; CuF: number; CpF: number; Cspec: number }> {
  return postJSON("/api/electrochemistry/double-layer-capacitance", { epsilon, d, area });
}

// ── Substrates (calc.substrates) ────────────────────────────────────────────
/** Built-in substrate reference table. */
export function getSubstrates(): Promise<{ substrates: SubstrateInfo[] }> {
  return getJSON("/api/substrates");
}

/** One substrate by name. */
export function getSubstrate(name: string): Promise<SubstrateInfo> {
  return getJSON(`/api/substrates/${encodeURIComponent(name)}`);
}

/** Epitaxial lattice mismatch f = (a_film − a_sub)/a_sub. */
export function substrateMismatch(
  aFilm: number,
  aSub: number,
): Promise<{ mismatch: number; mismatchPct: number; description: string }> {
  return postJSON("/api/substrates/mismatch", { a_film: aFilm, a_sub: aSub });
}

// ── Semiconductor device physics (calc.semiconductor) ───────────────────────
/** n_i = √(N_c N_v)·exp(−E_g/2k_BT) (cm⁻³). */
export function semiconductorIntrinsic(
  eg: number,
  meStar: number,
  mhStar: number,
  t: number,
): Promise<{ ni: number; Nc: number; Nv: number; Eg: number; T: number }> {
  return postJSON("/api/semiconductor/intrinsic", { eg, me_star: meStar, mh_star: mhStar, t });
}

/** n, p from charge-neutrality + mass-action; doping type. */
export function semiconductorCarrierConc(
  nd: number,
  na: number,
  ni: number,
): Promise<{ n: number; p: number; type: string }> {
  return postJSON("/api/semiconductor/carrier-concentration", { nd, na, ni });
}

/** V_bi = (k_BT/q)·ln(N_a N_d / n_i²) (V). */
export function semiconductorBuiltInPotential(
  na: number,
  nd: number,
  ni: number,
  t: number,
): Promise<{ Vbi: number }> {
  return postJSON("/api/semiconductor/built-in-potential", { na, nd, ni, t });
}

/** Depletion width W, x_n, x_p (nm) and Wcm (cm). */
export function semiconductorDepletionWidth(
  vbi: number,
  na: number,
  nd: number,
  epsilonR: number,
  t: number,
): Promise<{ W: number; Wcm: number; xn: number; xp: number }> {
  return postJSON("/api/semiconductor/depletion-width", { vbi, na, nd, epsilon_r: epsilonR, t });
}

/** D = μ·k_BT/q (cm²/s). */
export function semiconductorDiffusionCoeff(
  mu: number,
  t: number,
): Promise<{ D: number; mu: number; T: number }> {
  return postJSON("/api/semiconductor/diffusion-coeff", { mu, t });
}

/** L = √(D·τ) (cm / µm). */
export function semiconductorDiffusionLength(
  d: number,
  tau: number,
): Promise<{ L: number; Lum: number; D: number; tau: number }> {
  return postJSON("/api/semiconductor/diffusion-length", { d, tau });
}

/** E_F − E_i = k_BT·asinh(Δ/2n_i) (eV). */
export function semiconductorFermiLevel(
  eg: number,
  meStar: number,
  mhStar: number,
  nd: number,
  na: number,
  t: number,
): Promise<{ EF: number; type: string }> {
  return postJSON("/api/semiconductor/fermi-level", {
    eg,
    me_star: meStar,
    mh_star: mhStar,
    nd,
    na,
    t,
  });
}

/** L_D = √(ε₀εᵣk_BT/(q²n)) (nm). */
export function semiconductorDebyeLength(
  n: number,
  epsilonR: number,
  t: number,
): Promise<{ LD: number; LDcm: number }> {
  return postJSON("/api/semiconductor/debye-length", { n, epsilon_r: epsilonR, t });
}

/** n_s = n·t (cm⁻²). */
export function semiconductorSheetCarrierDensity(
  n: number,
  t: number,
): Promise<{ ns: number; n: number; t: number }> {
  return postJSON("/api/semiconductor/sheet-carrier-density", { n, t });
}

/** v_th = √(3k_BT/(m* m₀)) (cm/s). */
export function semiconductorThermalVelocity(
  mStar: number,
  t: number,
): Promise<{ vth: number; mStar: number; T: number }> {
  return postJSON("/api/semiconductor/thermal-velocity", { m_star: mStar, t });
}

/** R_H = (1/q)(pμ_h² − nμ_e²)/(pμ_h + nμ_e)² (cm³/C). */
export function semiconductorHallCoefficient(
  n: number,
  p: number,
  muE: number,
  muH: number,
): Promise<{ RH: number; apparent_type: string }> {
  return postJSON("/api/semiconductor/hall-coefficient", { n, p, mu_e: muE, mu_h: muH });
}

/** Caughey-Thomas μ_e, μ_h (cm²/V·s). */
export function semiconductorMobilityModel(
  material: string,
  t: number,
  n: number,
): Promise<{ muE: number; muH: number; material: string }> {
  return postJSON("/api/semiconductor/mobility-model", { material, t, n });
}

// ── Thin Film (calc.thin_film) ──────────────────────────────────────────────
/** Deposition rate = thickness/time. */
export function thinFilmDepositionRate(
  thickness: number,
  time: number,
): Promise<{ rate: number; rate_nm_per_min: number }> {
  return postJSON("/api/thin-film/deposition-rate", { thickness, time });
}

/** Sputter deposition rate from yield, current density, density, molar mass. */
export function thinFilmSputterRate(
  y: number,
  j: number,
  rho: number,
  m: number,
): Promise<{ rate: number; rate_nm_per_min: number }> {
  return postJSON("/api/thin-film/sputter-rate", { y, j, rho, m });
}

/** Thermal diffusion length L = √(D·t). */
export function thinFilmDiffusionLength(
  d: number,
  t: number,
): Promise<{ L: number; L_nm: number; L_um: number }> {
  return postJSON("/api/thin-film/diffusion-length", { d, t });
}

/** Implant dose = I·t/(q·A). */
export function thinFilmDoseFromCurrent(
  current: number,
  time: number,
  area: number,
): Promise<{ dose: number }> {
  return postJSON("/api/thin-film/dose-from-current", { current, time, area });
}

/** Peak concentration from dose + projected-range straggle. */
export function thinFilmDoseToConcentration(
  dose: number,
  rp: number,
  deltaRp: number,
): Promise<{ Cpeak: number }> {
  return postJSON("/api/thin-film/dose-to-concentration", { dose, rp, delta_rp: deltaRp });
}

/** Kiessig fringe thickness from Δq (with refraction correction). */
export function thinFilmKiessig(
  deltaQ: number,
  sld?: number,
  qc?: number,
): Promise<{ thickness: number; thickness_nm: number; Qc: number; thickness_raw: number }> {
  return postJSON("/api/thin-film/kiessig-thickness", { delta_q: deltaQ, sld, qc });
}

/** Series + parallel thermal conductivity of a multilayer stack. */
export function thinFilmMultilayerThermal(
  thicknesses: number[],
  kappas: number[],
): Promise<{ k_series: number; k_parallel: number; total_thickness: number; n_layers: number }> {
  return postJSON("/api/thin-film/multilayer-thermal", { thicknesses, kappas });
}

/** LSS projected range R_p + straggle ΔR_p. */
export function thinFilmProjectedRange(
  ion: string,
  target: string,
  energy: number,
): Promise<{ Rp: number; deltaRp: number; warning: string }> {
  return postJSON("/api/thin-film/projected-range", { ion, target, energy });
}

/** Stoney film stress from substrate curvature. */
export function thinFilmStoneyStress(
  es: number,
  nus: number,
  ts: number,
  tf: number,
  r: number,
): Promise<{ stress: number; stress_MPa: number; stress_GPa: number }> {
  return postJSON("/api/thin-film/stoney-stress", { es, nus, ts, tf, r });
}

/** Thermal-mismatch strain/stress between film and substrate. */
export function thinFilmThermalMismatch(
  alphaFilm: number,
  alphaSub: number,
  deltaT: number,
  e?: number,
  nu?: number,
): Promise<{ strain: number; stress_MPa: number; description: string }> {
  return postJSON("/api/thin-film/thermal-mismatch", {
    alpha_film: alphaFilm,
    alpha_sub: alphaSub,
    delta_t: deltaT,
    e,
    nu,
  });
}

// ── Superconductor (calc.superconductor) ────────────────────────────────────
/** λ(T) = λ₀/√(1 − (T/Tc)⁴) (nm). */
export function scLondonDepth(
  lambda0: number,
  t: number,
  tc: number,
): Promise<{ lambda: number; lambda0: number; T: number; Tc: number }> {
  return postJSON("/api/superconductor/london-depth", { lambda0, t, tc });
}

/** ξ(T) = ξ₀/√(1 − (T/Tc)²) (nm). */
export function scCoherenceLength(
  xi0: number,
  t: number,
  tc: number,
): Promise<{ xi: number; xi0: number; T: number; Tc: number }> {
  return postJSON("/api/superconductor/coherence-length", { xi0, t, tc });
}

/** κ = λ/ξ; type 'I' (κ < 1/√2) or 'II'. */
export function scGlParameter(
  lambda: number,
  xi: number,
): Promise<{ kappa: number; lambda: number; xi: number; type: string }> {
  return postJSON("/api/superconductor/gl-parameter", { lambda_: lambda, xi });
}

/** Hc, Hc1, Hc2 (Oe) and type; pass material for preset λ/ξ. */
export function scCriticalFields(
  hc0: number,
  tc: number,
  t: number,
  material?: string,
): Promise<{ Hc: number; Hc1: number; Hc2: number; type: string; T: number; Tc: number }> {
  return postJSON("/api/superconductor/critical-fields", { hc0, tc, t, material });
}

/** Jd = Hc(T)/(3√6·π·λ(T)) (A/cm² and MA/cm²). */
export function scDepairingCurrent(
  hc0: number,
  lambda0: number,
  tc: number,
  t: number,
): Promise<{ Jd: number; JdMA: number; T: number; Tc: number }> {
  return postJSON("/api/superconductor/depairing-current", { hc0, lambda0, tc, t });
}

/** Δ₀ = 1.764·k_B·Tc (meV); Mühlschlegel Δ(T) when T given. */
export function scBcsGap(
  tc: number,
  t?: number,
): Promise<{ delta0: number; ratio: number; deltaT: number; Tc: number; T: number }> {
  return postJSON("/api/superconductor/bcs-gap", { tc, t });
}

// ── Magnetic properties (calc.magnetic) ─────────────────────────────────────
/** Moment → emu / A·m² / µ_B (+ magnetization & µ_B/atom when V, atoms given). */
export function magneticMomentConvert(
  value: number,
  unit: string,
  volume?: number,
  atoms?: number,
): Promise<{
  emu: number;
  am2: number;
  mu_b: number;
  m_cgs: number | null;
  m_si: number | null;
  mu_b_per_atom: number | null;
}> {
  return postJSON("/api/magnetic/moment-convert", { value, unit, volume, atoms });
}

/** Demagnetizing factors Nz, Nxy, 4πNz from a geometry label. */
export function magneticDemag(
  shape: string,
): Promise<{ Nz: number; Nxy: number; shape: string; n_cgs: number }> {
  return postJSON("/api/magnetic/demag", { shape });
}

/** µ_eff (µ_B) and order type from Curie constant C and Weiss temperature θ. */
export function magneticCurieWeiss(
  c: number,
  theta: number,
): Promise<{ mu_eff: number; C: number; theta: number; mag_type: string }> {
  return postJSON("/api/magnetic/curie-weiss", { C: c, theta });
}

/** Langevin L(x) = coth(x) − 1/x; x = µH/(k_B T) (CGS: emu, Oe, K). */
export function magneticLangevin(
  mu: number,
  fieldOe: number,
  temperature: number,
): Promise<{ L: number; x: number; n_mu_b: number }> {
  return postJSON("/api/magnetic/langevin", { mu, field_oe: fieldOe, temperature });
}

/** Domain-wall width δ = π√(A/K) and energy E = 4√(AK). */
export function magneticDomainWall(
  exchangeA: number,
  anisotropyK: number,
): Promise<{ delta_cm: number; delta_nm: number; e_wall_erg_cm2: number; e_wall_mj_m2: number }> {
  return postJSON("/api/magnetic/domain-wall", {
    exchange_a: exchangeA,
    anisotropy_k: anisotropyK,
  });
}

/** Combine two datasets pointwise on A's x-grid (B interpolated). calc.aggregate. */
export function datasetAlgebra(body: {
  dataset_a: DataStruct;
  dataset_b: DataStruct;
  operation: string;
  interp_method?: string;
  channel_a?: number;
  channel_b?: number;
}): Promise<DataStruct> {
  return postJSON("/api/aggregate/algebra", body);
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

/** Current plot-state snapshot for the .ogs GRAPH block (item 26) — mirrors
 *  the Zustand plot fields (yKeys/xKey/xLog/yLog/xLim/yLim/y2Keys). */
export interface OriginGraphSpec {
  y_keys?: number[] | null;
  x_key?: number | null;
  x_log?: boolean;
  y_log?: boolean;
  x_lim?: [number, number] | null;
  y_lim?: [number, number] | null;
  y2_keys?: number[];
}

/** Export a DataStruct as an Origin LabTalk .ogs script + CSV (zipped).
 *  ``graph``, when given, exports the current plot state (selected
 *  channels, axis limits/log flags, y2 split) as an Origin GRAPH, not just
 *  the rebuilt workbook. */
export function exportOrigin(body: {
  dataset: DataStruct;
  filename?: string;
  log_x?: boolean;
  log_y?: boolean;
  make_graph?: boolean;
  graph?: OriginGraphSpec;
}): Promise<void> {
  return postDownload("/api/export/origin", body, "export.zip");
}

/** Whether COM "Send to Origin" is usable right now (Windows + pywin32 +
 *  QZ_ORIGIN_COM=1); everywhere it's false, use exportOrigin instead. */
export function originComStatus(): Promise<{ available: boolean }> {
  return getJSON("/api/export/origin-com/status");
}

/** Push datasets into a RUNNING OriginPro instance as new workbooks (COM). */
export function sendToOrigin(body: {
  datasets: { dataset: DataStruct; name: string }[];
}): Promise<{ books: string[]; rows: number[] }> {
  return postJSON("/api/export/origin-com", body);
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
/** Publication-figure request (shared by the download + preview paths). */
export interface FigureSpec {
  dataset: DataStruct;
  x_key?: number | string;
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
  /** Property-panel overrides (#11): fonts/legend/ticks/spines/limits/margins. */
  overrides?: FigureOverrides | null;
  filename?: string;
}

export function exportFigure(body: FigureSpec): Promise<void> {
  return postDownload("/api/export/figure", body, `figure.${body.fmt ?? "pdf"}`);
}

/** Preview render + element hit-map (#13): PNG + per-artist pixel boxes. */
export function renderFigureHitmap(body: FigureSpec): Promise<FigureHitmap> {
  return postJSON("/api/export/figure-hitmap", body);
}

/** Render a figure and return the raw image bytes — for an in-app WYSIWYG
 *  preview (the figure builder), as opposed to exportFigure which downloads. */
export async function renderFigureBlob(body: FigureSpec): Promise<Blob> {
  const res = await fetch("/api/export/figure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  return res.blob();
}

/** Posted joint-parameter samples for a corner (pairs) plot — e.g.
 *  `/api/fitting/posterior`'s `samples`, or `/api/fitting/bootstrap`'s
 *  `boot_samples` (pass `return_samples: true` to get it). Stateless: no fit
 *  is re-run server-side. */
export interface CornerFigureSpec {
  samples: number[][];
  param_names: string[];
  truths?: number[] | null;
  fmt?: string;
  style?: string;
  dpi?: number;
  bins?: string | number;
  title?: string;
  width_in?: number;
  height_in?: number;
  filename?: string;
}

/** Render a pairwise posterior/bootstrap corner plot server-side (matplotlib)
 *  and download it (gap #29). */
export function exportCornerFigure(body: CornerFigureSpec): Promise<void> {
  return postDownload("/api/export/corner-figure", body, `corner.${body.fmt ?? "pdf"}`);
}

/** Ternary diagram request: 3-component composition scatter plot (gap #23). */
export interface TernaryFigureSpec {
  data: number[][];
  labels?: [string, string, string];
  values?: number[] | null;
  fmt?: string;
  style?: string;
  dpi?: number;
  marker_size?: number;
  title?: string;
  filename?: string;
}

/** Render a ternary diagram (3-component scatter) server-side (matplotlib)
 *  and download it (gap #23). */
export function exportTernaryFigure(body: TernaryFigureSpec): Promise<void> {
  return postDownload("/api/export/ternary-figure", body, `ternary.${body.fmt ?? "pdf"}`);
}

/** Vector field plot request: quiver or streamline visualization (gap #23). */
export interface FieldFigureSpec {
  x_axis: number[];
  y_axis: number[];
  u_grid: number[][];
  v_grid: number[][];
  kind?: "quiver" | "streamline";
  fmt?: string;
  style?: string;
  dpi?: number;
  title?: string;
  x_label?: string;
  y_label?: string;
  filename?: string;
}

/** Render a vector field plot (quiver arrows or streamlines) server-side
 *  (matplotlib) and download it (gap #23). */
export function exportFieldFigure(body: FieldFigureSpec): Promise<void> {
  return postDownload("/api/export/field-figure", body, `field.${body.fmt ?? "pdf"}`);
}

/** A statistical-plot export request (StatStage's "Export figure" button):
 *  `data` is a list of groups for box/violin, or one flat sample for
 *  qq/histogram — the SAME raw values the interactive stats/box, /violin,
 *  /qq, /histogram calls saw, so the exported figure matches the stage. */
export interface StatplotFigureSpec {
  kind: "box" | "violin" | "qq" | "probability" | "histogram";
  data: number[][] | number[];
  labels?: string[] | null;
  fmt?: string;
  style?: string;
  dist?: string;
  bins?: string | number;
  fit?: string | null;
  title?: string;
  x_label?: string;
  y_label?: string;
  dpi?: number;
  filename?: string;
}

/** Render a statistical plot (box/violin/Q-Q/histogram) server-side
 *  (matplotlib) and download it (gap #16). */
export function exportStatplotFigure(body: StatplotFigureSpec): Promise<void> {
  return postDownload("/api/export/statplot-figure", body, `statplot.${body.fmt ?? "pdf"}`);
}

// ── Categorical (bar/column) plots — gap #20 ────────────────────────────────
// Same category x series matrix the interactive stat stage's "bar" mode
// computes locally (lib/barlayout.buildBarMatrix): `values[group][series]` is
// the mean, `errors[group][series]` the SEM (null = no error bar for that
// cell), so the exported figure matches the on-screen bars exactly.

/** A grouped/stacked bar-chart export request (StatStage bar mode's "Export
 *  figure" button). */
export interface CategoricalFigureSpec {
  groups: string[]; // category tick labels, in axis order
  series: string[]; // series (legend) labels, in stack/cluster order
  values: number[][]; // [group][series] bar height (mean)
  errors: (number | null)[][]; // [group][series] SEM (null = no whisker)
  stacked?: boolean;
  fmt?: string;
  style?: string;
  title?: string;
  x_label?: string;
  y_label?: string;
  dpi?: number;
  filename?: string;
}

/** Render a grouped/stacked bar chart server-side (matplotlib) and download
 *  it (gap #20). */
export function exportCategoricalFigure(body: CategoricalFigureSpec): Promise<void> {
  return postDownload("/api/export/categorical-figure", body, `bar.${body.fmt ?? "pdf"}`);
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

export function subtractHysteresisBackground(body: {
  h: number[];
  m: number[];
  hi_fraction?: number;
  min_points?: number;
}): Promise<{ corrected: (number | null)[]; slope: number; offset: number }> {
  return postJSON("/api/magnetometry/subtract-hysteresis-background", body);
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

/** H/V line cut through a 2-D map → a 1-D DataStruct (calc.linecut). */
export function rsmLinecut(body: {
  dataset: DataStruct;
  direction: "h" | "v";
  value: number;
  space?: string;
  width?: number;
}): Promise<DataStruct> {
  return postJSON("/api/rsm/linecut", body);
}

/** Arbitrary segment cut p0→p1 through the scattered 2-D cloud. */
export function rsmCutSegment(body: {
  dataset: DataStruct;
  p0: [number, number];
  p1: [number, number];
  n?: number;
  width?: number;
  space?: string;
}): Promise<DataStruct> {
  return postJSON("/api/rsm/cut-segment", body);
}

/** Integrate the whole map onto one axis (Σframes → I vs 2θ, or Σpixels). */
export function rsmProjection(body: {
  dataset: DataStruct;
  axis?: "pixels" | "frames";
  space?: string;
}): Promise<DataStruct> {
  return postJSON("/api/rsm/projection", body);
}

// ── Report sheets (#36) ─────────────────────────────────────────────────────

/** Shape an analysis result into a #36 report sheet via the backend emitters
 *  (one emission source of truth — the frontend never re-shapes results). */
export function reportEmit(body: {
  kind: "curve_fit" | "multipeak_fit" | "integrate" | "batch_integrate" | "anova" | "stats_table";
  result?: Record<string, unknown>;
  records?: Record<string, unknown>[];
  title?: string;
  model_name?: string;
  param_names?: string[];
  param_units?: string[];
  columns?: string[];
  caption?: string;
  source_refs?: { kind: string; id: string; name?: string }[];
}): Promise<{ report: ReportSheet }> {
  return postJSON("/api/report/emit", body);
}

/** Render a report sheet server-side and download it (.html/.tex/.docx/.pptx). */
export function reportExport(
  report: ReportSheet,
  format: "html" | "latex" | "docx" | "pptx",
  filename: string,
): Promise<void> {
  return postDownload("/api/report/export", { report, format, filename }, filename);
}

// ── Test chooser (#26) ──────────────────────────────────────────────────────

/** Assumption checks -> recommended test (+ endpoint + reasons). */
export function statsRecommend(body: {
  groups: number[][];
  paired?: boolean;
  alpha?: number;
}): Promise<Recommendation> {
  return postJSON("/api/stats/recommend", body);
}

/** The tests the chooser can recommend — the only paths statsRunTest accepts. */
const RUNNABLE_TESTS = new Set([
  "/api/stats/ttest",
  "/api/stats/wilcoxon",
  "/api/stats/mann-whitney",
  "/api/stats/anova",
  "/api/stats/kruskal",
]);

/** Run a chooser-recommended test by its endpoint path (allowlisted). */
export function statsRunTest(
  path: string,
  body: Record<string, unknown>,
): Promise<CalcResult> {
  if (!RUNNABLE_TESTS.has(path)) {
    return Promise.reject(new Error(`unknown test endpoint: ${path}`));
  }
  return postJSON(path, body);
}

// ── Peak integration (#32) ──────────────────────────────────────────────────

/** One integrated region from /api/peaks/integrate. */
export interface IntegratedPeak {
  region: [number, number];
  area: number;
  area_pct: number;
  centroid: number;
  height: number;
  position: number;
  fwhm: number;
  [key: string]: unknown;
}

/** Full /api/peaks/integrate response (one or more regions). The ROI gadget's
 *  Integrate mode (#34) always sends a single region, but keeps the full
 *  shape — that's what `from_integrate`'s report emitter expects verbatim. */
export interface IntegrateResponse {
  peaks: IntegratedPeak[];
  total_area: number;
  baseline: string;
}

/** Integrate-only peak analysis: net area/centroid/FWHM/%-area per region. */
export function peaksIntegrate(body: {
  x: number[];
  y: number[];
  regions: [number, number][];
  baseline?: "linear" | "none";
}): Promise<IntegrateResponse> {
  return postJSON("/api/peaks/integrate", body);
}

// ── FFT spectral (gap #34 ROI gadget family) ────────────────────────────────

/** /api/spectral/fft response — magnitude/psd/phase spectrum (never complex;
 *  see the route's own docstring). `window` is dropped server-side. */
export interface FftSpectralResult {
  freq: number[];
  magnitude?: (number | null)[];
  psd?: (number | null)[];
  phase?: (number | null)[];
  df: number;
  nfft: number;
  fs: number;
  windowName: string;
  [key: string]: unknown;
}

/** Single-record FFT spectrum of one ROI's (x, y). Defaults to a one-sided
 *  magnitude spectrum (hanning window, mean-detrended) — the ROI gadget's
 *  FFT mode never requests "complex" (unserializable; see the route). */
export function fftSpectral(body: {
  x: number[];
  y: number[];
  window?: string;
  output_type?: "psd" | "magnitude" | "phase";
  sided?: "one" | "two";
  detrend?: "mean" | "linear" | "none";
}): Promise<FftSpectralResult> {
  return postJSON("/api/spectral/fft", body);
}

// ── Import wizard + saved filters (ORIGIN_GAP_PLAN #40) ────────────────────

/** Best-effort starting `ImportSettings` for a file's raw text. */
export function importGuess(text: string): Promise<ImportSettingsWire> {
  return postJSON("/api/import/guess", { text });
}

/** Parse the first rows under `settings` (or auto-guess if `null`) for the
 *  wizard's live preview table. */
export function importPreview(
  text: string,
  settings: ImportSettingsWire | null,
  maxRows = 30,
): Promise<ImportPreviewResponse> {
  return postJSON("/api/import/preview", { text, settings, max_rows: maxRows });
}

/** Import the full text under confirmed settings into a DataStruct. */
export function importParse(
  text: string,
  settings: ImportSettingsWire,
): Promise<DataStruct> {
  return postJSON("/api/import/parse", { text, settings });
}

/** All saved import filters (name + glob + settings), most-recent last. */
export function listImportFilters(): Promise<ImportFilterWire[]> {
  return getJSON("/api/import/filters");
}

/** Save (upsert by name) a filter binding a glob to import settings. */
export function saveImportFilter(
  name: string,
  glob: string,
  settings: ImportSettingsWire,
): Promise<ImportFilterWire> {
  return postJSON("/api/import/filters", { name, glob, settings });
}

/** Delete a saved filter by name. */
export function deleteImportFilter(name: string): Promise<{ deleted: string }> {
  return deleteJSON(`/api/import/filters/${encodeURIComponent(name)}`);
}
