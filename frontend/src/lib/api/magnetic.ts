// /api/magnetic/* wrappers. `magneticCurieWeissFit` was extracted first (the
// lib/api.ts pin had zero headroom); the original five joined it in the R8
// bundle-diet pass (2026-08-23, see api/reference.ts's header for why) —
// they were still defined directly in lib/api.ts, so useApp.ts's unrelated
// eager imports from that SAME file were dragging this lazy-only
// (MagneticTab only) calculator set into the eager bundle purely by file
// co-location. NOT re-exported by lib/api.ts (zero headroom there);
// MagneticTab imports everything directly from this path.

import { postJSON } from "./http";
import type { components } from "./schema";

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

/** Demagnetizing factors for a custom geometry: a cylinder's length and
 *  diameter, or a prolate (c/a) / oblate (a/c) spheroid's axis ratio. */
export function magneticDemagCustom(
  body: components["schemas"]["DemagCustomRequest"],
): Promise<{ Nz: number; Nxy: number; shape: string; n_cgs: number }> {
  return postJSON("/api/magnetic/demag-custom", body);
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

/** Curie-Weiss fit of a 1/chi vs T sweep -> theta_CW (K), C (emu*K/mol),
 *  mu_eff (mu_B), fit R^2, and the inv_chi series used for the fit. */
export function magneticCurieWeissFit(body: {
  temperature: number[];
  susceptibility: number[];
  fit_range?: [number, number] | null;
}): Promise<{
  theta_cw: number;
  C: number;
  mu_eff: number | null;
  fit_line: [number, number];
  r2: number;
  inv_chi: (number | null)[];
}> {
  return postJSON("/api/magnetic/curie-weiss-fit", body);
}

export type CurieWeissResponseBasis =
  | "molar_susceptibility"
  | "total_moment"
  | "mass_moment";

export interface CurieWeissDataFitResult {
  theta_cw: number;
  C: number;
  mu_eff: number | null;
  fit_line: [number, number];
  r2: number;
  inv_chi: (number | null)[];
  susceptibility_molar: (number | null)[];
  susceptibility_errors_molar: (number | null)[][];
  inverse_errors: (number | null)[][];
  fit_inv_chi: (number | null)[];
  fit_mask: boolean[];
  n_fit: number;
  fit_range_used: [number, number];
  excluded_nonpositive: number;
}

/** Loaded-data Curie-Weiss fit. Raw moment is converted to molar
 * susceptibility only with explicit field and sample context. */
export function magneticCurieWeissDataFit(body: {
  temperature: number[];
  response: number[];
  response_basis: CurieWeissResponseBasis;
  fit_range: [number, number];
  field?: number[] | null;
  field_unit?: string;
  sample_mass_g?: number | null;
  molar_mass_g_mol?: number | null;
  response_errors?: number[][];
  /** Applied-field 1-sigma columns (in `field_unit`), combined in quadrature. */
  field_errors?: number[][];
}): Promise<CurieWeissDataFitResult> {
  return postJSON("/api/magnetic/curie-weiss-data-fit", body);
}

/** Per-series X / Y factors that put several M(T) or M(H) series in one unit
 *  (`calc/magnetic_series_compare.py`). Refuses (400) a blank unit, a non-K
 *  temperature, or series on different bases (total vs per-mass vs per-volume). */
export function magneticSeriesComparePlan(body: {
  series: { label: string; x_unit: string; y_unit: string }[];
  axis: "field" | "temperature";
  x_unit?: string | null;
  y_unit?: string | null;
}): Promise<{
  axis: "field" | "temperature";
  x_unit: string;
  y_unit: string;
  series: { label: string; x_factor: number; y_factor: number }[];
}> {
  return postJSON("/api/magnetic/series-compare-plan", body);
}

export type SusceptibilityOutput = "volume" | "mass" | "molar";

/** chi = M / H on a volume, mass or molar basis (CGS or SI), with propagated
 *  uncertainty (`calc/magnetic_derived_quantities.py`). Zero-field rows are
 *  `null`. The backend refuses a basis that needs a sample quantity not sent. */
export function magneticSusceptibility(body: {
  field: number[];
  response: number[];
  response_unit: string;
  field_unit: string;
  output: SusceptibilityOutput;
  system?: "cgs" | "si";
  sample_mass_g?: number | null;
  sample_volume_cm3?: number | null;
  molar_mass_g_mol?: number | null;
  response_errors?: number[][];
  field_errors?: number[][];
}): Promise<{
  susceptibility: (number | null)[];
  errors: (number | null)[][];
  unit: string;
  system: "cgs" | "si";
  output: SusceptibilityOutput;
  response_unit: string;
  field_unit: string;
  basis_factor: number;
  n_invalid_field: number;
  n_low_field: number;
  low_field_oe: number;
  sample_used: { mass_g: number | null; volume_cm3: number | null; molar_mass_g_mol: number | null };
  formula: string;
}> {
  return postJSON("/api/magnetic/susceptibility", body);
}

/** Moment in mu_B per formula unit from a per-mass or total moment
 *  (`calc/magnetic_derived_quantities.py`; mu_B and N_A from the constants module). */
export function magneticMomentPerFormulaUnit(body: {
  response: number[];
  response_unit: string;
  molar_mass_g_mol?: number | null;
  sample_mass_g?: number | null;
  response_errors?: number[][];
}): Promise<{
  moment: (number | null)[];
  errors: (number | null)[][];
  unit: string;
  response_unit: string;
  scale: number;
  sample_used: { mass_g: number | null; molar_mass_g_mol: number };
  constants: { muB_J_per_T: number; NA_per_mol: number };
  formula: string;
}> {
  return postJSON("/api/magnetic/moment-per-formula-unit", body);
}

/** One M(H) isotherm for the isotherm analyses; `magnetization_error` is the
 *  optional per-point 1-sigma (same length and unit as the magnetization). */
export interface MagIsotherm {
  temperature: number;
  field: number[];
  magnetization: number[];
  magnetization_error?: number[] | null;
}

/** The first-order propagation status every isotherm result carries. */
export interface IsothermUncertainty {
  propagated: boolean;
  method: string | null;
  reason: string | null;
}

export interface EntropyCurve {
  max_field: number;
  delta_s: number[];
  /** First-order 1-sigma of each ΔS, or null when no complete M uncertainty was sent. */
  delta_s_sigma: number[] | null;
  peak_delta_s: number;
  peak_delta_s_sigma: number | null;
  peak_temperature: number;
  /** NaN in the backend (a flank never drops, or fewer than 3 temperatures) arrives as null. */
  t_cold: number | null;
  t_hot: number | null;
  fwhm: number | null;
  rcp: number | null;
}

export interface EntropyChangeResult {
  temperature: number[];
  unit: string;
  field_unit: string;
  curves: EntropyCurve[];
  method: string;
  uncertainty: IsothermUncertainty;
}

export interface ArrottIsotherm {
  temperature: number;
  n_points: number;
  x: number[];
  y: number[];
  slope: number;
  intercept: number;
  slope_se: number | null;
  intercept_se: number | null;
  r2: number | null;
  /** First-order 1-sigma of the intercept from the M uncertainty (null: none sent). */
  intercept_sigma_m: number | null;
  spontaneous_magnetization: number;
}

export interface ArrottResult {
  beta: number;
  gamma: number;
  x_label: string;
  y_label: string;
  magnetization_si_unit: string;
  isotherms: ArrottIsotherm[];
  tc: number | null;
  tc_sigma: number | null;
  tc_method: string;
  uncertainty: IsothermUncertainty;
}

/** Maxwell-relation ΔS_M(T) and RCP from isotherms (`calc/magnetic_entropy.py`). */
export function magneticEntropyChange(body: {
  isotherms: MagIsotherm[];
  field_unit: string;
  magnetization_unit: string;
  max_fields: number[];
}): Promise<EntropyChangeResult> {
  return postJSON("/api/magnetic/entropy-change", body);
}

/** Arrott / Arrott-Noakes lines per isotherm and Tc (`calc/magnetic_critical.py`). */
export function magneticArrott(body: {
  isotherms: MagIsotherm[];
  field_unit: string;
  magnetization_unit: string;
  window: [number, number];
  beta: number;
  gamma: number;
}): Promise<ArrottResult> {
  return postJSON("/api/magnetic/arrott", body);
}
