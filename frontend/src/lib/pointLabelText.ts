// The eager half of point labels (gap audit 8, LBL): the layout types, the empty
// layout and the label text of a row. lib/pointLabelLayout.ts (the layout itself)
// and lib/figurePointLabels.ts are LAZY chunks for the eager-bundle budget; the live
// plot and the hover readout need only these.

import { categoricalLevels, labelForCode } from "./categorical";
import { MAX_LABEL_CHARS } from "./pointLabels";
import type { DataStruct } from "./types";

/** One labelled point: data coordinates, the text, the dataset row (0-based),
 *  the dataset channel and its index among the shown curves. */
export interface LabelPoint { x: number; y: number; text: string; row: number; ch: number; s: number }
export interface LabelLayout { points: LabelPoint[]; note: string | null; refusal: string | null }
export const NO_LABELS: LabelLayout = { points: [], note: null, refusal: null };

/** The label text of one dataset row (a category name, or the number to 6
 *  significant digits), or null when blank / not a number. */
export function labelText(data: DataStruct, key: number, row: number): string | null {
  return labelTexter(data, key)(row);
}

/** `labelText` for many rows of one column: the category table is read once. */
export function labelTexter(data: DataStruct, key: number): (row: number) => string | null {
  const levels = categoricalLevels(data, key);
  return (row) => {
    const v = data.values[row]?.[key];
    if (v === undefined || !Number.isFinite(v)) return null;
    const raw = levels ? labelForCode(levels, v) : String(Number(v.toPrecision(6)));
    const t = raw?.trim();
    if (!t) return null;
    return t.length > MAX_LABEL_CHARS ? `${t.slice(0, MAX_LABEL_CHARS - 1)}…` : t;
  };
}
