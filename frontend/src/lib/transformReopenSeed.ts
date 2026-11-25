// "Open in Resample" and "Open in Average curves" (OPEN_ITEMS row 12,
// reopen-seven lane): the recorded transform parameters read back strictly.
// Both transforms record their COMPLETE parameters (`settings.params`, the same
// object the pipeline replays), so a version-1 result already carries
// everything the dialog reads. FAIL CLOSED: null unless every field the dialog
// needs is present and of the right type; a partial record is never seeded.
// Lazy: imported by the two panels' hooks and the lazy opener only.

import type { ReopenSeed } from "./committedOutputReopen";
import type { AverageGrid } from "./transformAverage";
import { RESAMPLE_METHODS, type OutOfRange, type ResampleMethod } from "./transformResample";

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export type ResampleSeed =
  | { mode: "n_points"; nPoints: number; method: ResampleMethod; outOfRange: OutOfRange; sortUnsorted: boolean }
  | { mode: "step"; step: number; method: ResampleMethod; outOfRange: OutOfRange; sortUnsorted: boolean }
  | { mode: "range"; start: number; stop: number; step: number; method: ResampleMethod; outOfRange: OutOfRange; sortUnsorted: boolean };

/** The Resample dialog's recorded grid. A "match another dataset's x" result has a second source (the generic plan refuses it), so it is not read here either. */
export function resampleSeed(s: ReopenSeed | null | undefined): ResampleSeed | null {
  const p = s?.["params"];
  if (!isObject(p) || p["op"] !== "resample") return null;
  const { mode, method, outOfRange, sortUnsorted } = p;
  if (!RESAMPLE_METHODS.includes(method as ResampleMethod) || (outOfRange !== "nan" && outOfRange !== "clip") || typeof sortUnsorted !== "boolean") return null;
  const common = { method: method as ResampleMethod, outOfRange: outOfRange as OutOfRange, sortUnsorted };
  if (mode === "n_points") {
    const n = p["nPoints"];
    return isNumber(n) && Number.isInteger(n) && n >= 2 ? { mode, nPoints: n, ...common } : null;
  }
  if (mode === "step") {
    const step = p["step"];
    return isNumber(step) && step > 0 ? { mode, step, ...common } : null;
  }
  if (mode === "range") {
    const { start, stop, step } = p;
    return isNumber(start) && isNumber(stop) && isNumber(step) && step !== 0 ? { mode, start, stop, step, ...common } : null;
  }
  return null;
}

export interface AverageSeed {
  /** The y column by name; "" = each curve's first. */
  channel: string;
  grid: AverageGrid;
  step: number | null;
  sortUnsorted: boolean;
  allowUnitMismatch: boolean;
  /** The averaged worksheets, the primary first (the result's sources). */
  picked: readonly string[];
}

/** The Average N tab's recorded run; `sourceIds` are the result's sources (primary first) and must be the recorded `with` list after the primary. */
export function averageSeed(s: ReopenSeed | null | undefined, sourceIds: readonly string[]): AverageSeed | null {
  const p = s?.["params"];
  if (!isObject(p) || p["op"] !== "average" || sourceIds.length < 2) return null;
  const { channel, grid, step, sortUnsorted, allowUnitMismatch } = p;
  if (typeof channel !== "string" || (grid !== "union" && grid !== "step") || typeof sortUnsorted !== "boolean") return null;
  if (allowUnitMismatch !== undefined && typeof allowUnitMismatch !== "boolean") return null;
  if (grid === "step" ? !(isNumber(step) && step > 0) : step !== undefined) return null;
  const others = p["with"];
  if (!Array.isArray(others) || others.length !== sourceIds.length - 1) return null;
  if (!others.every((item, i) => isObject(item) && item["id"] === sourceIds[i + 1])) return null;
  return { channel, grid, step: grid === "step" ? (step as number) : null, sortUnsorted, allowUnitMismatch: allowUnitMismatch === true, picked: sourceIds };
}
