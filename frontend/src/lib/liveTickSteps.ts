// The major tick increment the focused canvas actually DREW on each axis, so
// an export with an automatic increment marks the same ticks the screen
// shows (figures integration: the screen read 2, 4, ... where the export's
// matplotlib AutoLocator chose 2.5, 5, ...). The two locators are different
// algorithms sized to different pixel lengths, so neither can recompute the
// other's choice; the canvas' pick travels instead, as the existing
// `x_step` / `y_step` / `y2_step` (a typed increment already did), and the
// backend's MultipleLocator places the ticks (`calc.figure_ticks`).
//
// Module-scope seam like `lib/waterfallOffset.publishLiveWaterfallSpan`: the
// focused stage's canvas publishes (`Stage/liveTicksPlugin.ts`), the export
// reads at command time, keyed by dataset so a refocus race never carries
// one plot's ticks onto another. Not store state -- publishing must cause no
// re-render.

import type { FigureSpec } from "./api/figures";

export interface LiveTickSteps {
  datasetId: string | null;
  x?: number;
  y?: number;
  y2?: number;
}

let live: LiveTickSteps | null = null;

/** Publish (or clear, with null) the increments the focused canvas drew. */
export function publishLiveTickSteps(v: LiveTickSteps | null): void {
  live = v;
}

/** The focused canvas' increments for `datasetId`, or null. */
export function readLiveTickSteps(datasetId: string): LiveTickSteps | null {
  return live && live.datasetId === datasetId ? live : null;
}

/** The smallest positive gap between drawn ticks (a broken axis' splits
 *  skip the elided stretch, so the first gap alone is not the increment). */
export function drawnIncrement(splits: readonly (number | null | undefined)[] | null | undefined): number | undefined {
  let best = Infinity;
  const v = (splits ?? []).filter((s): s is number => s != null && Number.isFinite(s));
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0 && d < best) best = d;
  }
  return Number.isFinite(best) ? Number(best.toPrecision(12)) : undefined;
}

const DATE_MODES = new Set(["date", "time", "datetime"]);

/** `spec` with each AUTOMATIC increment on a linear, numeric axis replaced by
 *  the one the canvas drew. A typed increment, a log / reciprocal axis, a
 *  date or category axis, and the paneled layouts (facets, X breaks, polar,
 *  encodings), whose panels pick their own, are left alone. */
export function withLiveTickSteps(spec: FigureSpec, datasetId: string): FigureSpec {
  const drawn = readLiveTickSteps(datasetId);
  if (!drawn || spec.facets?.length || spec.polar || spec.encoding || spec.overrides?.x_breaks?.length) return spec;
  const xKey = typeof spec.x_key === "number" ? spec.x_key : null;
  const catX = xKey != null && spec.dataset.cat_levels?.[xKey] != null;
  const auto = (step: number | null | undefined, scale: string | undefined, fmt: { mode?: string } | undefined, value: number | undefined) =>
    step == null && (scale ?? "linear") === "linear" && !DATE_MODES.has(fmt?.mode ?? "auto") && value !== undefined;
  const out: FigureSpec = { ...spec };
  if (!catX && auto(spec.x_step, spec.x_scale, spec.x_fmt, drawn.x)) out.x_step = drawn.x;
  if (auto(spec.y_step, spec.y_scale, spec.y_fmt, drawn.y)) out.y_step = drawn.y;
  if (spec.y2_keys?.length && auto(spec.y2_step, spec.y2_scale, spec.y2_fmt, drawn.y2)) out.y2_step = drawn.y2;
  return out;
}
