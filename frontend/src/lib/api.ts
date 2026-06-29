// Typed fetch layer over the FastAPI backend. All endpoints are under /api
// (dev: Vite proxies to uvicorn :8000; prod: same-origin static mount).

import type { SubstrateInfo } from "../components/workshops/calculators/SubstratesTab";
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
  filename?: string;
}

export function exportFigure(body: FigureSpec): Promise<void> {
  return postDownload("/api/export/figure", body, `figure.${body.fmt ?? "pdf"}`);
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
