// Apply the focused canvas' drawn tick increments (`lib/liveTickSteps.ts`)
// to an export spec. Export-only, so it rides the lazy export path
// (`lib/figureSpecStage.ts`) rather than the startup bundle, which keeps
// just the canvas' publish half.

import type { FigureSpec } from "./api/figures";
import { readLiveTickSteps } from "./liveTickSteps";

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
