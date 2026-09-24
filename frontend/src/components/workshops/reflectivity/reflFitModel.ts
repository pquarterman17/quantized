// Reflectivity fit — pure parameter model (P2.2 slice 2). Layer stack in,
// named fit parameters out, and fitted values back into the stack. No React,
// no store: the state hook (useReflFit.ts) owns the state, this owns the rules.
//
// Parameter names are the backend's contract (calc/refl_model.py):
// `L{i}.{thickness|sld|isld|roughness|msld}` plus `scale` and `background`.
// Layer 0 is the incident medium and layer n-1 the substrate, so the fields
// that mean nothing there are never offered (the backend refuses to fit them):
// L0.thickness, L0.roughness (roughness is the interface ABOVE a layer),
// L0.msld, and the substrate's thickness. `msld` is offered only when some
// channel carries a spin; an unpolarised fit never reads it.
//
// `isld` is POSITIVE = absorption everywhere (presets' `sldImag`, the route,
// the fit); the backend converts to the Parratt engine's sign (BUG-029).

import type { ReflFitParamResult, ReflFitResult } from "../../../lib/api/reflectivity";
import type { SldPreset } from "../../../lib/types";
import type { ModelLayer, Radiation } from "./useReflectivity";

export type LayerField = "thickness" | "sld" | "isld" | "roughness" | "msld";
export type GlobalField = "scale" | "background";

/** A layer's physical values after the preset/radiation lookup. */
export interface ResolvedLayer {
  thickness: number;
  sld: number;
  isld: number;
  roughness: number;
  msld: number;
}

/** What the user can set per parameter besides its value. `tie` "" = none. */
export interface ParamSettings {
  vary: boolean;
  min: number;
  max: number;
  tie: string;
}

/** One row of the parameter table. */
export interface FitParamRow extends ParamSettings {
  name: string;
  value: number;
  layer: number | null; // null for scale/background
  field: LayerField | GlobalField;
}

export interface FitGlobals {
  scale: number;
  background: number;
}

/** Per-name overrides, valid only for the layer count they were made at — a
 *  removed layer renumbers every name after it, and a setting silently moving
 *  to a different layer would be worse than losing it. */
export interface ParamOverrides {
  layerCount: number;
  byName: Record<string, Partial<ParamSettings>>;
}

/** A row's real SLD (Å⁻²) and absorption: from its preset for the selected
 *  radiation, else the row's manual values. Neutron presets carry no
 *  absorption (the presets' `sldImag` is the X-ray value). */
export function resolveLayer(row: ModelLayer, presets: SldPreset[], radiation: Radiation): ResolvedLayer {
  const p = row.preset === "" ? undefined : presets.find((x) => x.name === row.preset);
  return {
    thickness: row.thickness,
    sld: p ? (radiation === "xray" ? p.sldX : p.sldN) : row.sld,
    isld: p ? (radiation === "xray" ? p.sldImag : 0) : (row.isld ?? 0),
    roughness: row.roughness,
    msld: row.msld ?? 0,
  };
}

export function paramName(layer: number, field: LayerField): string {
  return `L${layer}.${field}`;
}

const LAYER_NAME = /^L(\d+)\.(thickness|sld|isld|roughness|msld)$/;

export function parseParamName(name: string): { layer: number; field: LayerField } | null {
  const m = LAYER_NAME.exec(name);
  return m ? { layer: Number(m[1]), field: m[2] as LayerField } : null;
}

/** The fields that mean something for layer `i` of `n`. */
export function layerFields(i: number, n: number, withMsld: boolean): LayerField[] {
  const out: LayerField[] = [];
  if (i > 0 && i < n - 1) out.push("thickness");
  out.push("sld", "isld");
  if (i > 0) out.push("roughness");
  if (withMsld && i > 0) out.push("msld");
  return out;
}

/** Default [min, max] around a starting value. Thickness ±50 % floored at 0;
 *  roughness 0..3·max(σ, 5 Å); SLDs ±50 % of |value| (±1e-6 Å⁻² at 0), with
 *  absorption floored at 0 (negative absorption is gain); scale 0.5..2;
 *  background 0..1e-4. Always widened to contain the value itself. */
export function defaultBounds(field: LayerField | GlobalField, value: number): [number, number] {
  const half = value !== 0 ? 0.5 * Math.abs(value) : 1e-6;
  switch (field) {
    case "thickness":
      return value > 0 ? [Math.max(0, 0.5 * value), 1.5 * value] : [0, 100];
    case "roughness":
      return [0, 3 * Math.max(value, 5)];
    case "isld":
      return [value >= 0 ? Math.max(0, value - half) : value - half, value + half];
    case "sld":
    case "msld":
      return [value - half, value + half];
    case "scale":
      return value > 0 ? [Math.min(0.5, value / 2), Math.max(2, value * 2)] : [0.5, 2];
    case "background":
      return [Math.min(0, value), Math.max(1e-4, 2 * value)];
  }
}

/** Whether a parameter varies before the user says otherwise: only the
 *  background. Left fixed, an unmodelled background floor is absorbed by the
 *  layer parameters instead — measured in slice-2 verification: substrate
 *  roughness 1.49 Å against a true 3 Å, reduced χ² 1.34 against 1.01. Its
 *  default bounds (0..1e-4, `defaultBounds`) contain the default value 0.
 *  Scale stays fixed: it trades off against every SLD. */
export function defaultVary(field: LayerField | GlobalField): boolean {
  return field === "background";
}

function row(
  name: string,
  layer: number | null,
  field: LayerField | GlobalField,
  value: number,
  over: Partial<ParamSettings> | undefined,
): FitParamRow {
  const [lo, hi] = defaultBounds(field, value);
  return {
    name,
    layer,
    field,
    value,
    vary: over?.vary ?? defaultVary(field),
    min: over?.min ?? lo,
    max: over?.max ?? hi,
    tie: over?.tie ?? "",
  };
}

/** Every parameter row for the stack: the meaningful layer fields in layer
 *  order, then scale and background. */
export function buildParamRows(
  layers: ResolvedLayer[],
  overrides: ParamOverrides,
  globals: FitGlobals,
  withMsld: boolean,
): FitParamRow[] {
  const by = overrides.layerCount === layers.length ? overrides.byName : {};
  const rows: FitParamRow[] = [];
  layers.forEach((l, i) => {
    for (const f of layerFields(i, layers.length, withMsld)) {
      const name = paramName(i, f);
      rows.push(row(name, i, f, l[f], by[name]));
    }
  });
  rows.push(row("scale", null, "scale", globals.scale, by.scale));
  rows.push(row("background", null, "background", globals.background, by.background));
  // A tie to a parameter that is no longer offered would 422; drop it.
  const names = new Set(rows.map((r) => r.name));
  for (const r of rows) if (r.tie && !names.has(r.tie)) r.tie = "";
  return rows;
}

/** The first reason these rows cannot be fitted, or null. Mirrors the
 *  backend's own refusals so the user sees them before a round trip. */
export function validateRows(rows: FitParamRow[]): string | null {
  for (const r of rows) {
    if (!Number.isFinite(r.value)) return `${r.name}: value must be a finite number`;
    if (!r.vary || r.tie) continue;
    if (!Number.isFinite(r.min) || !Number.isFinite(r.max) || !(r.min < r.max)) {
      return `${r.name}: needs finite min < max to vary`;
    }
    if (r.value < r.min || r.value > r.max) {
      return `${r.name}: starting value ${formatNum(r.value)} is outside [${formatNum(r.min)}, ${formatNum(r.max)}]`;
    }
  }
  return null;
}

/** One request parameter with every field explicit — assignable to the
 *  wire's `ReflFitParameter`, and what a saved fit records it sent. */
export interface RequestParam {
  name: string;
  value: number;
  vary: boolean;
  min: number;
  max: number;
  tie: string | null;
}

/** Rows → the request's `parameters`. */
export function toRequestParams(rows: FitParamRow[]): RequestParam[] {
  return rows.map((r) => ({
    name: r.name,
    value: r.value,
    vary: r.vary,
    min: r.min,
    max: r.max,
    tie: r.tie || null,
  }));
}

const REL_TOL = 1e-12;
function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= REL_TOL * Math.max(Math.abs(a), Math.abs(b), 1e-300);
}

/** A layer row with one field set. Thickness/roughness/msld are plain edits;
 *  an SLD or absorption edit turns a preset row into a manual one carrying its
 *  current resolved values, so the other SLD component is kept. */
function patchLayer(row: ModelLayer, r: ResolvedLayer, field: LayerField, value: number): ModelLayer {
  if (field === "thickness" || field === "roughness" || field === "msld") return { ...row, [field]: value };
  if (row.preset !== "" && same(r[field], value)) return row; // unchanged: keep the preset
  return { ...row, preset: "", sld: r.sld, isld: r.isld, [field]: value };
}

/** Set one layer parameter's value in the model (the param table's value
 *  column edits the model directly — the model is the single source). */
export function setLayerParam(
  layers: ModelLayer[],
  presets: SldPreset[],
  radiation: Radiation,
  name: string,
  value: number,
): ModelLayer[] {
  const p = parseParamName(name);
  if (!p || p.layer >= layers.length) return layers;
  return layers.map((row, i) =>
    i === p.layer ? patchLayer(row, resolveLayer(row, presets, radiation), p.field, value) : row,
  );
}

/** What a fit result's parameter NAMES are bound to: the layer order and
 *  each row's material, plus the radiation that resolved their SLDs. Names
 *  are positional (`L2.sld`), so a result may only be written back into a
 *  stack with the same signature — after a removed layer, `L2` is a
 *  different layer (the substrate, say), and after a radiation switch a
 *  preset's SLD is the other radiation's. */
export function stackSignature(layers: ModelLayer[], radiation: Radiation): string {
  return JSON.stringify([radiation, layers.map((l) => l.preset)]);
}

/** Why a result fitted against `basis` cannot be applied to the current
 *  stack, or null when it can. */
export function applyBlockedReason(
  basis: { layers: ModelLayer[]; radiation: Radiation },
  layers: ModelLayer[],
  radiation: Radiation,
): string | null {
  if (basis.radiation !== radiation) return "the radiation changed since this fit — run it again to apply";
  if (stackSignature(basis.layers, radiation) !== stackSignature(layers, radiation)) {
    return "the layer stack changed since this fit — run it again to apply";
  }
  return null;
}

/** Write fitted values back into the stack: thickness, roughness and msld as
 *  given; SLD/absorption keep the preset when they did not move, and switch
 *  the row to a manual SLD when they did. */
export function applyResults(
  layers: ModelLayer[],
  presets: SldPreset[],
  radiation: Radiation,
  params: Pick<ReflFitParamResult, "name" | "value">[],
): ModelLayer[] {
  let out = layers;
  for (const p of params) {
    if (parseParamName(p.name)) out = setLayerParam(out, presets, radiation, p.name, p.value);
  }
  return out;
}

/** The fitted scale/background, falling back to the current values. */
export function fittedGlobals(params: Pick<ReflFitParamResult, "name" | "value">[], cur: FitGlobals): FitGlobals {
  const get = (n: string, d: number): number => params.find((p) => p.name === n)?.value ?? d;
  return { scale: get("scale", cur.scale), background: get("background", cur.background) };
}

/** The objective, labelled for what it is: only `dr` weighting is a χ². */
export function objectiveSummary(res: Pick<ReflFitResult, "weighting" | "reduced_chi2" | "reduced_sum_sq_log">): {
  label: string;
  value: number | null;
} {
  if (res.weighting === "dr") return { label: "reduced χ²", value: res.reduced_chi2 };
  return { label: "reduced Σ(Δlog₁₀R)²", value: res.reduced_sum_sq_log };
}

/** A value as EDITABLE text: lossless (it parses back to the same number) but
 *  compact, so an SLD reads "2.007e-5" in a narrow field instead of being
 *  clipped to "0.00002". */
export function editableNum(v: number): string {
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e5) ? v.toExponential() : String(v);
}

/** Compact number formatting for the tables (engineering-friendly). */
export function formatNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a < 1e-3 || a >= 1e5) return v.toExponential(3);
  return String(Number(v.toPrecision(5)));
}
