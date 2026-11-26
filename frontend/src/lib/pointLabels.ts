// Point labels (gap audit 8, LBL): print a column's value next to the points of
// any XY plot. A per-graph setting (`PlotView.pointLabels`), OFF by default
// (null), saved with the plot (.dwk, undo, figure documents) and sent to the
// vector export. The layout (which points get a label, and the text) is ONE pure
// computation, `lib/pointLabelLayout.ts`, run for the live canvas and again when
// the export request is built, from the same inputs; the export draws the
// resulting list (`calc/figure_point_labels.py`), so screen and export match.
// This module is only the eager model: the setting, its sanitizer and limits.

import { sanitizeLabelAvoid, type LabelAvoid } from "./pointLabelAvoid";

export type PointLabelMode = "all" | "selected" | "top";

export interface PointLabels {
  /** The label column: a value-channel index of the plot's dataset (text or numeric). */
  key: number;
  /** Which points: every point (thinned where crowded), the rows selected in the
   *  worksheet, or the `topN` points furthest from zero in |y|. */
  mode: PointLabelMode;
  topN: number;
  /** Plan item 18: place labels so they avoid each other (+ leader lines). Absent = off, today's placement. */
  avoid?: LabelAvoid;
}

export const POINT_LABEL_MODES: readonly PointLabelMode[] = ["all", "selected", "top"];
export const DEFAULT_TOP_N = 10;
export const MAX_TOP_N = 100;
/** The label text is cut to this many characters (an ellipsis marks the cut). */
export const MAX_LABEL_CHARS = 32;

/** A stored value (a `.dwk` plot view) -> a valid setting, or null (off).
 *  Fails closed: a non-integer or negative column, or an unknown mode, is off. */
export function sanitizePointLabels(raw: unknown): PointLabels | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== "number" || !Number.isInteger(o.key) || o.key < 0) return null;
  if (!POINT_LABEL_MODES.includes(o.mode as PointLabelMode)) return null;
  const n = o.topN;
  const topN = typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_TOP_N ? n : DEFAULT_TOP_N;
  const avoid = sanitizeLabelAvoid(o.avoid);
  return { key: o.key, mode: o.mode as PointLabelMode, topN, ...(avoid ? { avoid } : {}) };
}

// `POINT_LABEL_MODE_NAMES`, `MAX_ALL_POINTS` live in ./pointLabelNames.ts: no eager module uses them.
export * from "./pointLabelNames";
