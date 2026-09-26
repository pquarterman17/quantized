// Resample / align workshop — the form model (pure). The text fields the user
// types into, and their translation into the recorded `ResampleParams`
// (lib/transformResample.ts) or a plain message saying what is missing.

import type { OutOfRange, ResampleMethod, ResampleMode, ResampleParams } from "../../../lib/transformResample";
import { xExtent } from "../../../lib/plotDecimate";
import type { DataStruct } from "../../../lib/types";

export interface ResampleForm {
  mode: ResampleMode;
  nPoints: string;
  /** `step` mode: spacing over the source's own range. */
  step: string;
  start: string;
  stop: string;
  /** `range` mode's step (signed). */
  rangeStep: string;
  matchId: string;
  method: ResampleMethod;
  outOfRange: OutOfRange;
  sortUnsorted: boolean;
}

export const MODE_OPTIONS: { value: ResampleMode; label: string }[] = [
  { value: "n_points", label: "Number of points (over the data range)" },
  { value: "step", label: "Fixed step (over the data range)" },
  { value: "range", label: "Explicit start : step : stop" },
  { value: "match", label: "Match another dataset's x" },
];

export const OUT_OF_RANGE_OPTIONS: { value: OutOfRange; label: string }[] = [
  { value: "nan", label: "Leave blank (no extrapolation)" },
  { value: "clip", label: "Drop them (clip the grid)" },
];

export function defaultForm(matchId: string): ResampleForm {
  return {
    mode: "n_points",
    nPoints: "500",
    step: "",
    start: "",
    stop: "",
    rangeStep: "",
    matchId,
    method: "linear",
    outOfRange: "nan",
    sortUnsorted: false,
  };
}

const tidy = (v: number): string => String(Number(v.toPrecision(6)));

/** Seed the empty step/range fields from a dataset's x-range (100 intervals),
 *  leaving anything the user already typed alone. */
export function withRangeDefaults(f: ResampleForm, data: DataStruct | undefined): ResampleForm {
  const r = data ? xExtent(data.time) : null;
  if (!r || r[1] <= r[0]) return f;
  const step = tidy((r[1] - r[0]) / 100);
  return {
    ...f,
    step: f.step || step,
    start: f.start || tidy(r[0]),
    stop: f.stop || tidy(r[1]),
    rangeStep: f.rangeStep || step,
  };
}

function num(text: string, what: string): number | string {
  const t = text.trim();
  if (!t) return `enter ${what}`;
  const v = Number(t);
  return Number.isFinite(v) ? v : `${what} must be a number`;
}

/** The recorded params for this form, or a message saying what to fix. An
 *  accepted x-unit pair is added per dataset at commit (the acknowledgment). */
export function formToParams(
  f: ResampleForm,
  datasets: readonly { id: string; name: string }[],
): ResampleParams | string {
  const base = {
    op: "resample" as const,
    mode: f.mode,
    method: f.method,
    outOfRange: f.outOfRange,
    sortUnsorted: f.sortUnsorted,
  };
  switch (f.mode) {
    case "n_points": {
      const n = num(f.nPoints, "the number of points");
      if (typeof n === "string") return n;
      if (!Number.isInteger(n) || n < 2) return "the number of points must be a whole number ≥ 2";
      return { ...base, nPoints: n };
    }
    case "step": {
      const step = num(f.step, "a step");
      if (typeof step === "string") return step;
      if (step <= 0) return "the step must be positive";
      return { ...base, step };
    }
    case "range": {
      const start = num(f.start, "a start");
      if (typeof start === "string") return start;
      const stop = num(f.stop, "a stop");
      if (typeof stop === "string") return stop;
      const step = num(f.rangeStep, "a step");
      if (typeof step === "string") return step;
      if (step === 0) return "the step must not be zero";
      return { ...base, start, stop, step };
    }
    default: {
      const m = datasets.find((d) => d.id === f.matchId);
      if (!m) return "pick the dataset whose x to match";
      return { ...base, with: { id: m.id, name: m.name } };
    }
  }
}
