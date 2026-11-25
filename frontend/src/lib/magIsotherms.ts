// Isotherm analyses for magnetometry (OPEN_ITEMS row 36): the pure half. Read
// one M(H) series per selected worksheet, decide its temperature and whether
// its committed M uncertainty may be propagated, build the backend request in
// the common unit, and the result worksheets. The arithmetic (Maxwell dS, the
// Arrott fit, the first-order propagation) is the backend's (`calc/magnetic_
// entropy.py`, `magnetic_critical.py`, `magnetic_uncertainty.py`).
//
// Decisions (provisional, owner to confirm):
//  * Each worksheet is ONE isotherm: its own X must be a declared field (the
//    Compare tab's reader, no resampling); the response is matched by the
//    active worksheet's channel name. Units come from the existing unit plan
//    (`series_unit_plan`), so mixed Oe / T or emu/cm3 vs A/m are converted, and
//    a different basis (per mass vs per volume) is refused.
//  * The temperature is the user's, per worksheet. It is PRE-FILLED only from a
//    declared K temperature column whose spread is at most TEMP_SPREAD_K over
//    the analysis view (a sweep that drifts more is not an isotherm); the
//    user can overwrite it, and a blank one blocks the run.
//  * A +/- is reported only when EVERY worksheet has exactly one committed,
//    symmetric Y uncertainty column; otherwise none is sent and none shown
//    (never a zero). The propagation is first-order, points independent,
//    field and temperature exact (backend note, repeated in the UI).

import type { ArrottResult, EntropyChangeResult, MagIsotherm } from "./api/magnetic";
import type { OriginDesignation } from "./columnmeta";
import type { ErrorBinding } from "./errorRoles";
import { detectMagXKind } from "./magDataKind";
import type { CompareSeries } from "./magSeriesCompare";
import { readCompareSeries } from "./magSeriesCompare";
import { statsBatchData } from "./statsBatchColumns";
import type { Dataset, DataStruct } from "./types";

/** Largest max-min of a temperature column that still counts as one isotherm (K; provisional). */
export const TEMP_SPREAD_K = 1;

export interface IsothermRead { series: CompareSeries; suggestedT: number | null }

/** Mean of a declared-K temperature column that holds still (see TEMP_SPREAD_K), else null. */
export function suggestTemperature(dataset: Dataset): number | null {
  const data = statsBatchData(dataset);
  const cols = data.labels.map((label, i) => ({ label, i }))
    .filter(({ label, i }) => (data.units[i] ?? "").trim() === "K" && detectMagXKind(label, "K").kind === "temperature");
  if (cols.length !== 1) return null;
  const values = data.values.map((row) => row[cols[0]!.i] ?? Number.NaN).filter(Number.isFinite);
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return hi - lo <= TEMP_SPREAD_K && lo > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** One worksheet's isotherm (throws the reason: M(T) data, no declared field, ...). */
export function readIsotherm(dataset: Dataset, channel: string): IsothermRead {
  const series = readCompareSeries(dataset, channel);
  if (series.axis !== "field") {
    throw new Error(`"${dataset.name}" has a temperature X axis; an isotherm is M(H) at one temperature.`);
  }
  return { series, suggestedT: suggestTemperature(dataset) };
}

/** Whether every isotherm carries exactly one symmetric committed uncertainty (and why not). */
export function uncertaintyStatus(series: readonly CompareSeries[]): { usable: boolean; reason: string | null } {
  const counts = series.map((s) => s.yErrors.length);
  if (counts.every((c) => c === 0)) return { usable: false, reason: "No committed M uncertainty; no ± is reported." };
  if (counts.some((c) => c === 0)) return { usable: false, reason: "Only some worksheets have committed M uncertainty; no ± is reported." };
  if (series.some((s) => s.yErrors.some((e) => e.side !== "both"))) {
    return { usable: false, reason: "The committed M uncertainty is asymmetric (+/-); only symmetric uncertainty is propagated, so no ± is reported." };
  }
  if (counts.some((c) => c > 1)) {
    return { usable: false, reason: "A worksheet has more than one M uncertainty column (how to combine them is not guessed); no ± is reported." };
  }
  return { usable: true, reason: null };
}

// Units the Maxwell / Arrott routes accept (mirrors FIELD_UNITS / MAG_UNITS in calc/magnetic_isotherms.py:
// keep in step). Checked in the browser so a bad unit is refused with a pointer, not a logged 422.
const FIELD_UNITS = ["Oe", "T", "mT", "A/m", "kA/m"];
const MAG_UNITS = ["A/m", "kA/m", "emu/cm3", "emu/cm³", "emu/g"];

/** Why the isotherm routes would refuse these common units, saying where to set the unit; null when fine. */
export function isothermUnitProblem(fieldUnit: string, magnetizationUnit: string): string | null {
  if (!MAG_UNITS.includes(magnetizationUnit)) {
    return `The response unit "${magnetizationUnit || "(blank)"}" is not normalized, and isotherms need magnetization per volume or per mass `
      + `(A/m, kA/m, emu/cm3 or emu/g). Set it in Magnetometry tools > Units (normalize by sample volume or mass), then create the isotherms again.`;
  }
  if (!FIELD_UNITS.includes(fieldUnit)) {
    return `The field unit "${fieldUnit || "(blank)"}" is not one the isotherms accept (Oe, T, mT, A/m or kA/m). Set the worksheet's X unit in Magnetometry tools > Units, then try again.`;
  }
  return null;
}

/** The first problem with the temperatures (blank, non-positive or repeated), or null. */
export function temperatureProblem(names: readonly string[], temps: readonly (number | null)[]): string | null {
  const bad = temps.findIndex((t) => t === null || !Number.isFinite(t) || t <= 0);
  if (bad >= 0) return `Enter the temperature (K) of "${names[bad]}".`;
  const seen = new Map<number, string>();
  for (let i = 0; i < temps.length; i++) {
    const prior = seen.get(temps[i]!);
    if (prior !== undefined) return `"${prior}" and "${names[i]}" have the same temperature (${temps[i]} K); an isotherm family needs distinct temperatures.`;
    seen.set(temps[i]!, names[i]!);
  }
  return null;
}

/** Backend isotherms in the plan's common units (uncertainty only when `withSigma`). */
export function isothermBody(
  series: readonly CompareSeries[], temps: readonly number[], factors: readonly { x_factor: number; y_factor: number }[], withSigma: boolean,
): MagIsotherm[] {
  return series.map((s, i) => {
    const { x_factor: xf, y_factor: yf } = factors[i]!;
    return {
      temperature: temps[i]!,
      field: s.x.map((v) => v * xf),
      magnetization: s.y.map((v) => v * yf),
      ...(withSigma ? { magnetization_error: s.yErrors[0]!.values.map((v) => v * Math.abs(yf)) } : {}),
    };
  });
}

/** "1, 2, 5" -> [1, 2, 5]; a string says what is wrong. */
export function parseMaxFields(text: string): number[] | string {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 0) return "Enter at least one maximum field.";
  const values = parts.map(Number);
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return "Maximum fields must be positive numbers.";
  return values;
}

/** The largest field every isotherm reaches (a starting value for the field box), or null. */
export function commonMaxField(series: readonly CompareSeries[], factors: readonly { x_factor: number }[]): number | null {
  const reach = series.map((s, i) => Math.max(...s.x) * factors[i]!.x_factor);
  const lo = Math.min(...reach);
  if (!(Number.isFinite(lo) && lo > 0)) return null;
  // Three significant digits, never ROUNDED UP past what the shortest isotherm reaches (the route refuses a field it does not span).
  const v = Number(lo.toPrecision(3));
  return v <= lo ? v : Number((v - 10 ** (Math.floor(Math.log10(lo)) - 2)).toPrecision(3));
}

export interface IsothermWorksheet { data: DataStruct; errorRoles: ErrorBinding[]; columnDesignations: Record<number, OriginDesignation> }

const tag = (t: number): string => `T = ${Number(t.toPrecision(6))} K`;
const powUnit = (base: string, p: number): string => (p === 1 ? base : `(${base})^${Number(p.toPrecision(4))}`);

/** ΔS_M(T) worksheet: X = mid temperature, one Y per maximum field, its ± as a Y-error column when propagated. */
export function entropyWorksheet(res: EntropyChangeResult, meta: Record<string, unknown>): IsothermWorksheet {
  const labels: string[] = [];
  const units: string[] = [];
  const cols: number[][] = [];
  const designations: Record<number, OriginDesignation> = {};
  const errorRoles: ErrorBinding[] = [];
  for (const curve of res.curves) {
    const y = cols.length;
    designations[y] = "Y";
    labels.push(`ΔS_M (H = ${curve.max_field} ${res.field_unit})`);
    units.push(res.unit);
    cols.push(curve.delta_s);
    if (curve.delta_s_sigma) {
      designations[cols.length] = "Y-error";
      errorRoles.push({ channel: cols.length, target: y, axis: "y", side: "both" });
      labels.push(`ΔS_M ± (H = ${curve.max_field} ${res.field_unit})`);
      units.push(res.unit);
      cols.push(curve.delta_s_sigma);
    }
  }
  const time = res.temperature;
  return {
    data: {
      time, values: time.map((_, r) => cols.map((c) => c[r] ?? Number.NaN)), labels, units,
      metadata: {
        x_column_name: "Temperature", x_column_long: "Temperature (midpoint of adjacent isotherms)", x_column_unit: "K",
        error_roles: errorRoles,
        magnetometry_isotherm_entropy: {
          version: 1, ...meta, method: res.method, unit: res.unit, uncertainty: res.uncertainty,
          curves: res.curves.map((c) => ({
            max_field: c.max_field, peak_delta_s: c.peak_delta_s, peak_delta_s_sigma: c.peak_delta_s_sigma,
            peak_temperature: c.peak_temperature, fwhm: c.fwhm, rcp: c.rcp,
          })),
        },
      },
    },
    errorRoles, columnDesignations: designations,
  };
}

/** Arrott worksheet: one (X, Y) pair per isotherm over the fitted window, in SI as the backend returns it. */
export function arrottWorksheet(res: ArrottResult, meta: Record<string, unknown>): IsothermWorksheet {
  const n = Math.max(...res.isotherms.map((r) => r.x.length));
  const pad = (v: readonly number[]): number[] => Array.from({ length: n }, (_, i) => (i < v.length ? v[i]! : Number.NaN));
  const si = res.magnetization_si_unit;
  const xUnit = powUnit(`A/m / ${si}`, 1 / res.gamma);
  const yUnit = powUnit(si, 1 / res.beta);
  const labels: string[] = [];
  const units: string[] = [];
  const cols: number[][] = [];
  const designations: Record<number, OriginDesignation> = {};
  let time: number[] = [];
  res.isotherms.forEach((r, i) => {
    if (i === 0) time = pad(r.x);
    else {
      designations[cols.length] = "X";
      labels.push(`${res.x_label} [${tag(r.temperature)}]`);
      units.push(xUnit);
      cols.push(pad(r.x));
    }
    designations[cols.length] = "Y";
    labels.push(`${res.y_label} [${tag(r.temperature)}]`);
    units.push(yUnit);
    cols.push(pad(r.y));
  });
  const first = res.isotherms[0]!;
  return {
    data: {
      time, values: Array.from({ length: n }, (_, r) => cols.map((c) => c[r]!)), labels, units,
      metadata: {
        x_column_name: `${res.x_label} [${tag(first.temperature)}]`, x_column_long: res.x_label, x_column_unit: xUnit,
        magnetometry_isotherm_arrott: {
          version: 1, ...meta, beta: res.beta, gamma: res.gamma, si_unit: si, tc: res.tc, tc_sigma: res.tc_sigma,
          tc_method: res.tc_method, uncertainty: res.uncertainty,
          fits: res.isotherms.map((r) => ({
            temperature: r.temperature, n_points: r.n_points, slope: r.slope, intercept: r.intercept,
            intercept_sigma_m: r.intercept_sigma_m, intercept_se: r.intercept_se, r2: r.r2,
          })),
        },
      },
    },
    errorRoles: [], columnDesignations: designations,
  };
}

const sig = (v: number): string => Number(v.toPrecision(5)).toString();
const pm = (v: number, s: number | null): string => (s === null ? sig(v) : `${sig(v)} ± ${Number(s.toPrecision(2))}`);

/** Readout lines for the entropy result (no ± text unless it was propagated). */
export function entropyLines(res: EntropyChangeResult): string[] {
  const lines = res.curves.map((c) => {
    const rcp = c.rcp === null ? "" : `, RCP ${sig(c.rcp)} (no uncertainty)`;
    return `H = ${c.max_field} ${res.field_unit}: peak ΔS_M ${pm(c.peak_delta_s, c.peak_delta_s_sigma)} ${res.unit} at ${sig(c.peak_temperature)} K${rcp}`;
  });
  lines.push(res.uncertainty.propagated ? `± is ${res.uncertainty.method}.` : (res.uncertainty.reason ?? "No ± reported."));
  return lines;
}

/** Readout lines for the Arrott result. */
export function arrottLines(res: ArrottResult): string[] {
  const lines = [res.tc === null ? `No Tc: ${res.tc_method}.` : `Tc = ${pm(res.tc, res.tc_sigma)} K (${res.tc_method})`];
  for (const r of res.isotherms) {
    lines.push(`${tag(r.temperature)}: intercept ${pm(r.intercept, r.intercept_sigma_m)}, R² ${r.r2 === null ? "n/a" : sig(r.r2)}, ${r.n_points} points`);
  }
  lines.push(res.uncertainty.propagated
    ? `± is ${res.uncertainty.method}; it is the measurement part only, apart from the fit scatter (stored per isotherm in the worksheet), and does not include noise moving Tc to another bracket.`
    : (res.uncertainty.reason ?? "No ± reported."));
  return lines;
}
