// The one eager row-range helper: PlotView (lib/plotview.ts) reads a persisted range through it. Kept apart from
// lib/rowRange.ts so that module (the remap and the resolver) stays lazy.

import type { RowRange } from "./rowRange";

/** A persisted or hand-built range as a `RowRange`, or undefined when it is not one (non-integer, negative, reversed, or
 *  a deleted-away range carrying `was`). Never clamped: an unreadable range is dropped, so the view draws every row
 *  rather than limiting to a guess. A NAMED LINK (`{ named: id }`, ROW_RANGE_CONTRACT 5.2) keeps only its id: the rows
 *  it covers are read from the named range, so a link with no readable cache is an empty window (no rows) until then. */
export const sanitizeRowRange = (value: unknown): RowRange | undefined => {
  const { from, to, was, named } = (value ?? {}) as RowRange;
  const link = typeof named === "string" && named ? { named } : {};
  return was === undefined && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from ? { from, to, ...link } : link.named ? { from: 0, to: -1, ...link } : undefined;
};
