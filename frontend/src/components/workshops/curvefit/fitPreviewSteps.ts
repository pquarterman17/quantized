// Curve Fit: nudging one starting value up or down for the initial-guess
// preview. Pure.
//
// A step is RELATIVE to the value (1 % fine, 10 % coarse), because starts span
// decades (an amplitude of 3e-4 next to a centre of 1200) and a fixed step is
// wrong for one of them. A value of exactly 0 has no scale of its own, so it
// steps by an absolute 0.01 / 0.1. The result is clamped into the row's own
// bounds, so a nudge can never produce a start the fit would refuse.

import type { FitParamRow } from "../../../lib/fitParams";

export type StepSize = "fine" | "coarse";

export const STEP_FRACTION: Record<StepSize, number> = { fine: 0.01, coarse: 0.1 };

const bound = (text: string): number | null => {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** `value` stepped by `dir` (+1 / -1) at `size`, as the text a start cell holds.
 *  Null when `value` is not a finite number (nothing to step from). */
export function nudgeStart(value: number, dir: 1 | -1, size: StepSize, row?: Pick<FitParamRow, "min" | "max">): string | null {
  if (!Number.isFinite(value)) return null;
  const f = STEP_FRACTION[size];
  let next = value + dir * (value === 0 ? f : Math.abs(value) * f);
  const lo = row ? bound(row.min) : null;
  const hi = row ? bound(row.max) : null;
  if (lo !== null) next = Math.max(next, lo);
  if (hi !== null) next = Math.min(next, hi);
  return String(Number(next.toPrecision(10))); // 10 digits: no 0.30000000000000004 in the cell
}
