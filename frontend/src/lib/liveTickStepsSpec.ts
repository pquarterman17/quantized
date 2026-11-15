// Offer a canvas' drawn tick increments (`lib/liveTickSteps.ts`) to an export
// spec as HINTS (`x_step_hint` / `y_step_hint` / `y2_step_hint`). Applied
// only by the exports OF the focused window's own view -- Stage Export figure
// and Copy figure (`lib/figureSpecStage.ts`) and the Publication preview of
// that window (`workshops/figurebuilder/canonicalSession.sessionTickHints`),
// which therefore send the same request. The shared spec builder adds none,
// so batch export, Send to report, Figure Page and every other figure of the
// same dataset never carry them (review N1). The backend takes a hint only
// when it fits the laid-out export axes (`calc.tick_hint`). Export-only, so
// it rides the lazy export path rather than the startup bundle.

import type { FigureSpec } from "./api/figures";
import { liveTickSteps, type LiveTickSteps } from "./liveTickSteps";

/** The increments the canvas of window `windowId` drew, or null. Only the
 *  exports OF that window's own view ask (review N1): Stage Export / Copy and
 *  the Publication preview of it. Batch, report and every other figure of
 *  the same dataset never do -- the shared spec builder adds no hint. */
export function readLiveTickSteps(windowId: string | null | undefined): LiveTickSteps | null {
  return windowId && liveTickSteps?.windowId === windowId ? liveTickSteps : null;
}

const DATE_MODES = new Set(["date", "time", "datetime"]);

/** `spec` with a hint for each AUTOMATIC increment on a linear, numeric axis.
 *  A typed increment, a log / reciprocal axis, a date or category axis, and
 *  the paneled layouts (facets, X breaks, polar, encodings), whose panels pick
 *  their own, get none; nor does a Y2 increment without Y2 series. (A Y break,
 *  probability or custom-tick axis gets one, which the backend's own locator
 *  for that axis then replaces.) */
export function withLiveTickHints(spec: FigureSpec, drawn: LiveTickSteps | null | undefined): FigureSpec {
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
