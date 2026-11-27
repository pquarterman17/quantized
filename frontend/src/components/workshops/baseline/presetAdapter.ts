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

export function createBaselineAdapter(panel: BaselinePanelHandle): PresetAdapter<BaselineSettings> {
  return {
    workshop: BASELINE_WORKSHOP,
    label: "Baseline",
    runLabel: "Estimate",
    schema: BASELINE_SCHEMA,
    defaults: () => ({ ...DEFAULT_BASELINE_SETTINGS }),
    parse: (raw) =>
      parseFields<BaselineSettings>(raw, {
        method: checkOneOf(BASELINE_METHODS),
        lam: num(positive),
        p: num((n) => (n > 0 && n < 1 ? null : "must be between 0 and 1")),
        radius: num(whole(1)),
        order: num(whole(0)),
        maxWindowDeg: num(positive),
        regionXMin: edge,
        regionXMax: edge,
        regionYMin: edge,
        regionYMax: edge,
        maxIter: num(whole(1)),
        anchorMethod: checkOneOf(ANCHOR_INTERPOLATIONS),
      }),
    capture: () => settingsFrom(panel.getMethod(), panel.getParams()),
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
