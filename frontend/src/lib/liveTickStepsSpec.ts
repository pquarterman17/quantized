// Offer the focused canvas' drawn tick increments (`lib/liveTickSteps.ts`)
// to an export spec as HINTS (`x_step_hint` / `y_step_hint` / `y2_step_hint`).
// Applied by the shared spec builder (`lib/figureSpec.ts`), so Export figure,
// Copy figure and Publication preview send the same request. The backend
// takes a hint only when it fits the laid-out export axes (`calc.tick_hint`)
// and otherwise lets matplotlib's AutoLocator place the ticks. Export-only,
// so it rides the lazy export path rather than the startup bundle.

import type { FigureSpec } from "./api/figures";
import { readLiveTickSteps } from "./liveTickSteps";

const DATE_MODES = new Set(["date", "time", "datetime"]);

/** `spec` with a hint for each AUTOMATIC increment on a linear, numeric axis.
 *  A typed increment, a log / reciprocal axis, a date or category axis, and
 *  the paneled layouts (facets, X breaks, polar, encodings), whose panels pick
 *  their own, get none. `datasetId` null (a frozen document) gets none. */
export function withLiveTickHints(spec: FigureSpec, datasetId: string | null | undefined): FigureSpec {
  const drawn = datasetId ? readLiveTickSteps(datasetId) : null;
  if (!drawn || spec.facets?.length || spec.polar || spec.encoding || spec.overrides?.x_breaks?.length) return spec;
  const xKey = typeof spec.x_key === "number" ? spec.x_key : null;
  const catX = xKey != null && spec.dataset.cat_levels?.[xKey] != null;
  const auto = (step: number | null | undefined, scale: string | undefined, fmt: { mode?: string } | undefined, value: number | undefined) =>
    step == null && (scale ?? "linear") === "linear" && !DATE_MODES.has(fmt?.mode ?? "auto") && value !== undefined;
  const out: FigureSpec = { ...spec };
  if (!catX && auto(spec.x_step, spec.x_scale, spec.x_fmt, drawn.x)) out.x_step_hint = drawn.x;
  if (auto(spec.y_step, spec.y_scale, spec.y_fmt, drawn.y)) out.y_step_hint = drawn.y;
  if (spec.y2_keys?.length && auto(spec.y2_step, spec.y2_scale, spec.y2_fmt, drawn.y2)) out.y2_step_hint = drawn.y2;
  return out;
}
