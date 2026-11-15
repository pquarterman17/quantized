// One display-block series entry's validation, moved verbatim out of
// lib/plotspec2.ts (its module-size pin) when the display block gained the
// colour gradient (origin gap audit 4 G1, review L8).

import type { SeriesDisplay } from "./plotspec2";
import { MARKER_SHAPE_VALUES } from "./seriesStyleCycle";
import type { LineStyle, MarkerShape, StepMode } from "./types";

const LINE_STYLES: readonly LineStyle[] = ["solid", "dashed", "dotted"];
const STEP_MODES: readonly StepMode[] = ["pre", "post", "mid"];

/** Line width: 0 is a real, meaningful value (marker-only "scatter" preset —
 *  see SeriesStyleCard's trace-type toggle), so this allows zero; only a
 *  negative or absurd (>100 px) width drops. */
function isValidWidth(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

export function validateSeriesDisplay(v: unknown): SeriesDisplay | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: SeriesDisplay = {};
  if (typeof o.color === "string") out.color = o.color;
  if (isValidWidth(o.width)) out.width = o.width;
  if (typeof o.marker === "boolean") out.marker = o.marker;
  if (typeof o.markerShape === "string" && MARKER_SHAPE_VALUES.has(o.markerShape)) {
    out.markerShape = o.markerShape as MarkerShape;
  }
  if (typeof o.line === "string" && (LINE_STYLES as readonly string[]).includes(o.line)) {
    out.line = o.line as LineStyle;
  }
  if (typeof o.step === "string" && (STEP_MODES as readonly string[]).includes(o.step)) {
    out.step = o.step as StepMode;
  }
  if (typeof o.hidden === "boolean") out.hidden = o.hidden;
  if (o.axis === 0 || o.axis === 1) out.axis = o.axis;
  return out;
}
