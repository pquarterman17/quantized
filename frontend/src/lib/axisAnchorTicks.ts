// Anchored major ticks (plan item 24, Origin's "Anchor tick at"): on a LINEAR axis the majors sit at
// `anchor + k * step` for the step the axis already uses (its typed increment, else the auto step of the
// renderer drawing it). ONE pure rule: the canvas (`lib/axisExtras`, through `anchorSplits`) and the export
// (`calc/axis_anchor.py`, a locator wrapping the axis' own) both call it, pinned by
// `tests/fixtures/wire/axis_anchor.json`. A step of zero or a span of over MAX_ANCHOR_TICKS ticks draws no
// anchored ticks (the axis keeps its own).
//
// Loaded on demand with the axis extras chunk (eager bundle budget).

import type uPlot from "uplot";

export const MAX_ANCHOR_TICKS = 1000;

/** The ticks `anchor + k * step` inside [min, max] (a tick within 1e-9 steps of an end is kept), ascending,
 *  each rounded to 12 significant digits so `0.5 + 3 * 0.1` is 0.8, not 0.8000000000000002. */
export function anchorTicks(min: number, max: number, step: number, anchor: number): number[] {
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(anchor) || !Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  const first = Math.ceil((min - anchor) / step - 1e-9);
  const last = Math.floor((max - anchor) / step + 1e-9);
  if (last - first + 1 > MAX_ANCHOR_TICKS) return [];
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(Number((anchor + k * step).toPrecision(12)));
  return out;
}

/** Why an anchor cannot apply on this axis, or null. `scale` is the Axis dialog's scale choice. */
export function anchorProblem(scale: string, customTicks: boolean, broken: boolean): string | null {
  if (scale !== "linear") return "Anchor ticks need a linear axis.";
  if (customTicks) return "Anchor ticks cannot be combined with Tick positions.";
  if (broken) return "Anchor ticks cannot be combined with an axis break.";
  return null;
}

/** Make `axis` place its majors with `anchorTicks`, keeping whatever step its own splits use (the typed
 *  increment's splits, else uPlot's found increment). An axis whose splits give no step is left alone. */
export function anchorSplits(axis: uPlot.Axis, anchor: number): void {
  const inner = axis.splits;
  axis.splits = (u, axisIdx, min, max, incr, space) => {
    const own = typeof inner === "function" ? inner(u, axisIdx, min, max, incr, space) : inner ?? [];
    const step = own.length > 1 ? own[1] - own[0] : incr;
    const ticks = anchorTicks(min, max, step, anchor);
    return ticks.length ? ticks : own;
  };
}
