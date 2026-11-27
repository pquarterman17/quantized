// Baseline's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6), generic
// backend: Baseline has no legacy store. The settings are the method and its
// knobs, in a flat every-key form. Settings only (P5): the anchor points placed
// on a spectrum are positions on that data, so they are never stored; applying
// an "anchor" preset keeps the anchors already placed and says so. The region
// box edges are value-space numbers (null = automatic), which mean the same on
// any sheet, so they are kept.
// Lazy: loaded with the preset bar and after a successful commit.

import {
  checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { ANCHOR_INTERPOLATIONS, BASELINE_METHODS, type BaselineMethod } from "./baselineMethods";
import type { BaselineParams } from "./useBaseline";

export interface BaselineSettings {
  method: BaselineMethod;
  lam: number;
  p: number;
  radius: number;
  order: number;
  maxWindowDeg: number;
  /** null = automatic (the panel holds NaN). */
  regionXMin: number | null;
  regionXMax: number | null;
  regionYMin: number | null;
  regionYMax: number | null;
  maxIter: number;
  anchorMethod: string;
}

/** The slice of the panel the adapter reads and writes. */
export interface BaselinePanelHandle {
  getMethod(): BaselineMethod;
  getParams(): BaselineParams;
  setMethod(m: BaselineMethod): void;
  setParams(patch: Partial<BaselineParams>): void;
}

export const BASELINE_WORKSHOP = "baseline";
export const BASELINE_SCHEMA = 1;


const num = (extra?: (n: number) => string | null): FieldCheck => (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "must be a number";
  return extra ? extra(v) : null;
};
const edge: FieldCheck = (v) => (v === null || (typeof v === "number" && Number.isFinite(v)) ? null : "must be a number or null (automatic)");
const positive = (n: number) => (n > 0 ? null : "must be positive");
const whole = (min: number) => (n: number) => (Number.isInteger(n) && n >= min ? null : `must be a whole number of ${min} or more`);

const nanToNull = (n: number): number | null => (Number.isFinite(n) ? n : null);
const nullToNan = (n: number | null): number => n ?? Number.NaN;

export const DEFAULT_BASELINE_SETTINGS: Readonly<BaselineSettings> = Object.freeze({
  method: "als", lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2,
  regionXMin: null, regionXMax: null, regionYMin: null, regionYMax: null, maxIter: 50, anchorMethod: "pchip",
});

export function settingsFrom(method: BaselineMethod, p: BaselineParams): BaselineSettings {
  return {
    method, lam: p.lam, p: p.p, radius: p.radius, order: p.order, maxWindowDeg: p.maxWindowDeg,
    regionXMin: nanToNull(p.regionXMin), regionXMax: nanToNull(p.regionXMax),
    regionYMin: nanToNull(p.regionYMin), regionYMax: nanToNull(p.regionYMax),
    maxIter: p.maxIter, anchorMethod: p.anchorMethod,
  };
}

/** The knobs each method shows in the panel (BaselinePanel's FIELDS, plus the anchor interpolation). A knob its
 *  method does not use is hidden from the user, so it is never value-checked and never stored as a bad value. */
const USED_KNOBS: Readonly<Record<BaselineMethod, readonly (keyof BaselineSettings)[]>> = {
  als: ["lam", "p"], rollingball: ["radius"], modpoly: ["order"], snip: ["maxWindowDeg"],
  region: ["regionXMin", "regionXMax", "regionYMin", "regionYMax", "order"], anchor: ["anchorMethod"],
  shirley: ["maxIter"], xrdla: [], linear: [], quadratic: [], poly: ["order"],
};

/** The strict check of every knob; a hidden knob keeps only its type check. */
const KNOB_CHECKS: { [K in keyof BaselineSettings]: FieldCheck } = {
  method: checkOneOf(BASELINE_METHODS),
  lam: num(positive),
  p: num((n) => (n > 0 && n < 1 ? null : "must be between 0 and 1")),
  radius: num(whole(1)),
  order: num(whole(0)),
  maxWindowDeg: num(positive),
  regionXMin: edge, regionXMax: edge, regionYMin: edge, regionYMax: edge,
  maxIter: num(whole(1)),
  anchorMethod: checkOneOf(ANCHOR_INTERPOLATIONS),
};

function methodOf(raw: unknown): BaselineMethod | null {
  const m = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["method"] : null;
  return typeof m === "string" && (BASELINE_METHODS as readonly string[]).includes(m) ? (m as BaselineMethod) : null;
}

function specFor(method: BaselineMethod | null): { [K in keyof BaselineSettings]: FieldCheck } {
  if (!method) return KNOB_CHECKS; // the method check then names the problem
  const used = USED_KNOBS[method];
  const spec: { [K in keyof BaselineSettings]: FieldCheck } = { ...KNOB_CHECKS };
  for (const key of Object.keys(spec) as (keyof BaselineSettings)[]) {
    if (key === "method" || used.includes(key)) continue;
    if (!key.startsWith("region") && key !== "anchorMethod") spec[key] = num(); // the edges and the interpolation already only check their type
  }
  return spec;
}

/** What a save stores: a hidden knob holding a value its own check refuses (Radius 0 left under Rolling ball,
 *  then SNIP chosen) falls back to its default, so a preset never carries a value the user cannot see. */
function storableSettings(settings: BaselineSettings): BaselineSettings {
  const used = USED_KNOBS[settings.method];
  const out: Record<string, unknown> = { ...settings };
  for (const key of Object.keys(KNOB_CHECKS) as (keyof BaselineSettings)[]) {
    if (key !== "method" && !used.includes(key) && KNOB_CHECKS[key](settings[key]) !== null) out[key] = DEFAULT_BASELINE_SETTINGS[key];
  }
  return out as unknown as BaselineSettings;
}

export function createBaselineAdapter(panel: BaselinePanelHandle): PresetAdapter<BaselineSettings> {
  return {
    workshop: BASELINE_WORKSHOP,
    label: "Baseline",
    runLabel: "Estimate",
    schema: BASELINE_SCHEMA,
    defaults: () => ({ ...DEFAULT_BASELINE_SETTINGS }),
    parse: (raw) => parseFields<BaselineSettings>(raw, specFor(methodOf(raw))),
    capture: () => storableSettings(settingsFrom(panel.getMethod(), panel.getParams())),
    apply(settings): ApplyOutcome {
      const { method, regionXMin, regionXMax, regionYMin, regionYMax, ...rest } = settings;
      panel.setMethod(method);
      panel.setParams({
        ...rest,
        regionXMin: nullToNan(regionXMin), regionXMax: nullToNan(regionXMax),
        regionYMin: nullToNan(regionYMin), regionYMax: nullToNan(regionYMax),
      });
      const notes = method === "anchor" ? ["anchor points are placed on the plot and are not stored in a preset"] : [];
      return { ok: true, applied: Object.keys(settings), skipped: [], notes };
    },
    describe: (s) => {
      const knob =
        s.method === "als" ? `lambda ${s.lam}, p ${s.p}` : s.method === "rollingball" ? `radius ${s.radius}` : s.method === "snip" ? `window ${s.maxWindowDeg}`
          : s.method === "shirley" ? `${s.maxIter} iterations` : s.method === "anchor" ? `${s.anchorMethod} interpolation`
            : s.method === "modpoly" || s.method === "poly" || s.method === "region" ? `order ${s.order}` : "";
      return knob ? `${s.method}, ${knob}` : s.method;
    },
  };
}

/** After a successful subtract: remember the method and knobs it used. */
export function recordBaselineRun(method: BaselineMethod, params: BaselineParams): void {
  recordLastUsed({ workshop: BASELINE_WORKSHOP, schema: BASELINE_SCHEMA }, settingsFrom(method, params));
}
