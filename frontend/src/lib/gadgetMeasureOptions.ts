// The curve-measurement gadget kinds' own settings (level crossings, rise time)
// and the requests they make. Pure, and loaded only with the lazy gadget
// compute chunk. Every option is opt-in: with the defaults the rise-time
// request is exactly the one the gadget always sent (10 / 90 %, edge detected,
// plateaus estimated; `GADGET_STEP_BODY`), and the panel's for the same rows.

import type { LevelCrossingBody, StepTimeBody } from "./api/curveMeasure";

/** Rise-time percentages: the two usual pairs, or a custom pair. */
export type StepPreset = "10-90" | "20-80" | "custom";

export interface GadgetMeasureOptions {
  /** Level crossings: the Y level ("" = the middle of the region's Y range). */
  level: string;
  /** Level crossings: the dead band half-width ("" = none). */
  hysteresis: string;
  direction: "both" | "rising" | "falling";
  stepPreset: StepPreset;
  /** Custom rise-time percentages (used when `stepPreset` is "custom"). */
  lowPct: string;
  highPct: string;
  edge: "auto" | "rise" | "fall";
  /** Reference levels of the step ("" = estimated from the plateaus). */
  lowLevel: string;
  highLevel: string;
  /** Intersect: the worksheet curve B is read from (null = the active one). */
  curveBSheet: string | null;
}

export const DEFAULT_GADGET_MEASURE_OPTIONS: GadgetMeasureOptions = {
  level: "", hysteresis: "", direction: "both",
  stepPreset: "10-90", lowPct: "10", highPct: "90", edge: "auto", lowLevel: "", highLevel: "",
  curveBSheet: null,
};

/** The rise-time request the panel makes with its untouched settings
 *  (10 % / 90 %, edge detected, plateaus estimated). */
export const GADGET_STEP_BODY = { low_fraction: 0.1, high_fraction: 0.9, edge: "auto" } as const;

/** A request or the plain reason it cannot be made (shown in the chip's error slot). */
export type Built<T> = { ok: true; body: T } | { ok: false; error: string };

const parse = (text: string): number | null => (text.trim() === "" ? null : Number(text));

/** An optional numeric field: undefined when empty, an error text when not a number. */
function optional(text: string, what: string): number | undefined | string {
  const v = parse(text);
  if (v === null) return undefined;
  return Number.isFinite(v) ? v : `${what} is not a number.`;
}

/** The rise-time request for the chosen percentages, edge and reference levels. */
export function stepBodyFor(o: GadgetMeasureOptions, x: number[], y: number[]): Built<StepTimeBody> {
  let lo = 10;
  let hi = 90;
  if (o.stepPreset === "20-80") [lo, hi] = [20, 80];
  if (o.stepPreset === "custom") {
    lo = parse(o.lowPct) ?? Number.NaN;
    hi = parse(o.highPct) ?? Number.NaN;
  }
  if (!(lo > 0 && lo < hi && hi < 100)) return { ok: false, error: "the percentages must satisfy 0 < low < high < 100" };
  const low = optional(o.lowLevel, "the low level");
  const high = optional(o.highLevel, "the high level");
  if (typeof low === "string") return { ok: false, error: low };
  if (typeof high === "string") return { ok: false, error: high };
  const base = o.stepPreset === "10-90" && o.edge === "auto" ? GADGET_STEP_BODY : { low_fraction: lo / 100, high_fraction: hi / 100, edge: o.edge };
  return { ok: true, body: { x, y, ...base, ...(low === undefined ? {} : { low_level: low }), ...(high === undefined ? {} : { high_level: high }) } };
}

/** The level-crossing request. An empty level is the middle of the region's own
 *  Y range, `(min + max) / 2` (`auto` says so, for the chip). */
export function levelBodyFor(o: GadgetMeasureOptions, x: number[], y: number[]): Built<LevelCrossingBody> & { auto?: boolean } {
  const given = parse(o.level);
  if (given !== null && !Number.isFinite(given)) return { ok: false, error: "the Y level is not a number" };
  const hysteresis = parse(o.hysteresis) ?? 0;
  if (!Number.isFinite(hysteresis) || hysteresis < 0) return { ok: false, error: "the dead band must be a number, not negative" };
  let level = given;
  if (level === null) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of y) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    level = (lo + hi) / 2;
  }
  return { ok: true, auto: given === null, body: { x, y, level, hysteresis, direction: o.direction } };
}
