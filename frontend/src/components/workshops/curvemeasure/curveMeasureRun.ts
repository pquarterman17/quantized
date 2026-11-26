// Curve measurements: the panel's settings turned into one request (with the
// same checks the backend makes, so a bad entry is named before a round trip)
// and the result union the panel, the readout and the commit share.

import {
  measureIntersect,
  measureLevelCrossings,
  measureStepTime,
  type IntersectResult,
  type LevelCrossingResult,
  type StepTimeResult,
} from "../../../lib/api/curveMeasure";
import { parseField } from "../analysisextras/columnPicks";

export type MeasureMode = "intersect" | "level" | "step";

export interface MeasureSettings {
  mode: MeasureMode;
  level: string;
  hysteresis: string;
  direction: "both" | "rising" | "falling";
  /** Step fractions in percent (10 and 90 by default). */
  lowPct: string;
  highPct: string;
  edge: "auto" | "rise" | "fall";
  /** Reference levels; empty = estimated from the plateaus. */
  lowLevel: string;
  highLevel: string;
}

export const DEFAULT_SETTINGS: MeasureSettings = {
  mode: "intersect", level: "", hysteresis: "", direction: "both",
  lowPct: "10", highPct: "90", edge: "auto", lowLevel: "", highLevel: "",
};

export type MeasureResult =
  | { mode: "intersect"; r: IntersectResult }
  | { mode: "level"; r: LevelCrossingResult }
  | { mode: "step"; r: StepTimeResult };

export interface Curve {
  x: number[];
  y: number[];
}

/** A number field that must be a finite number (or empty when `optional`). */
function num(text: string, what: string, optional = false): number | undefined {
  const v = parseField(text);
  if (v === null) {
    if (optional) return undefined;
    throw new Error(`Enter ${what}.`);
  }
  if (!Number.isFinite(v)) throw new Error(`${what} is not a number.`);
  return v;
}

/** Run the chosen measurement. Rejects with a plain message on a bad entry or
 *  a backend refusal (too few points, curves that do not overlap, no step). */
export async function runMeasure(s: MeasureSettings, a: Curve, b: Curve | null): Promise<MeasureResult> {
  if (s.mode === "intersect") {
    if (!b) throw new Error("Pick the second curve.");
    return { mode: "intersect", r: await measureIntersect({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }) };
  }
  if (s.mode === "level") {
    const level = num(s.level, "the Y level");
    const hysteresis = num(s.hysteresis, "the dead band", true) ?? 0;
    if (hysteresis! < 0) throw new Error("The dead band cannot be negative.");
    return { mode: "level", r: await measureLevelCrossings({ x: a.x, y: a.y, level: level!, hysteresis, direction: s.direction }) };
  }
  const lo = num(s.lowPct, "the low percentage")!;
  const hi = num(s.highPct, "the high percentage")!;
  if (!(lo > 0 && lo < hi && hi < 100)) throw new Error("The percentages must satisfy 0 < low < high < 100.");
  const body = {
    x: a.x, y: a.y, low_fraction: lo / 100, high_fraction: hi / 100, edge: s.edge,
    low_level: num(s.lowLevel, "the low level", true), high_level: num(s.highLevel, "the high level", true),
  };
  return { mode: "step", r: await measureStepTime(body) };
}
