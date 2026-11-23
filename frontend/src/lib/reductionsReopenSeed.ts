// "Open in Film thickness (FFT) / Reflectivity FFT" (OPEN_ITEMS row 12): the
// recorded settings of the two Reductions FFT outputs, read back strictly.
//
// FAIL CLOSED: a reader returns null unless EVERY setting is present and of the
// right type, so a tool is never seeded with part of a record. The picked
// intensity column is recorded by position AND name (`extra.picks`); it is
// restored only when the same name is still at that position of the source.
// Lazy: imported by the two hooks and the lazy opener (store/toolReopenPicks.ts)
// only, never by an eager module.

import type { ReopenSeed } from "./committedOutputReopen";
import type { CommitSettings } from "./committedOutput";

const WINDOWS = ["hann", "blackman", "none"] as const;
const PREPROCESS = ["logR", "logRQ4", "R", "RQ4"] as const;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** A range edge: a number, or null for "auto" (a non-finite edge is recorded as null). */
const isEdge = (value: unknown): value is number | null => value === null || isNumber(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

export interface FftThicknessSeed {
  col: number;
  wavelength: number;
  twoThetaMin: number | null;
  twoThetaMax: number | null;
  windowFn: (typeof WINDOWS)[number];
  maxThicknessNm: number;
}

export function fftThicknessSeed(s: ReopenSeed | null | undefined): FftThicknessSeed | null {
  if (!s) return null;
  const { col, wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm } = s;
  if (!isNumber(col) || !isNumber(wavelength) || !isEdge(twoThetaMin) || !isEdge(twoThetaMax)
    || !oneOf(windowFn, WINDOWS) || !isNumber(maxThicknessNm)) return null;
  return { col, wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm };
}

export interface ReflectivityFftSeed {
  col: number;
  isNeutron: boolean;
  wavelength: number;
  xMin: number | null;
  xMax: number | null;
  windowFn: (typeof WINDOWS)[number];
  preprocess: (typeof PREPROCESS)[number];
  maxThicknessNm: number;
  peakProminence: number;
}

export function reflectivityFftSeed(s: ReopenSeed | null | undefined): ReflectivityFftSeed | null {
  if (!s) return null;
  const { col, isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence } = s;
  if (!isNumber(col) || typeof isNeutron !== "boolean" || !isNumber(wavelength) || !isEdge(xMin) || !isEdge(xMax)
    || !oneOf(windowFn, WINDOWS) || !oneOf(preprocess, PREPROCESS) || !isNumber(maxThicknessNm) || !isNumber(peakProminence)) return null;
  return { col, isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence };
}

/** The picked columns as the commit records them (unkeyed, beside the settings):
 *  position AND name, so a reopen can prove each is still where it was.
 *  `xLabel` names column -1 (the worksheet's own X). */
export function recordedPickExtra(labels: readonly string[], cols: readonly number[], xLabel = ""): CommitSettings {
  return { picks: cols.map((index) => ({ index, label: index < 0 ? xLabel : (labels[index] ?? "") })) };
}

/** Why the recorded column picks cannot be restored on a source with `labels`
 *  (null: every one is still at its place, by position and name). */
export function recordedPickProblem(labels: readonly string[], extra: ReopenSeed | null, sourceName: string, xLabel = ""): string | null {
  const picks = extra?.["picks"];
  if (!Array.isArray(picks) || picks.length === 0) return "The columns it ran on were not recorded, so its settings are not restored.";
  for (const item of picks) {
    const pick = item && typeof item === "object" && !Array.isArray(item) ? item : null;
    if (!pick || !isNumber(pick["index"]) || typeof pick["label"] !== "string") {
      return "The columns it ran on were not recorded, so its settings are not restored.";
    }
    const now = pick["index"] < 0 ? xLabel : labels[pick["index"]];
    if (now !== pick["label"]) {
      return `The recorded column “${pick["label"]}” is no longer at its place in “${sourceName}” (its columns changed), so its settings are not restored.`;
    }
  }
  return null;
}
