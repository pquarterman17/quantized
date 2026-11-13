// Origin's nearest-preceding-X rule over a book's EFFECTIVE designations
// (lib/columnmeta.ts's `effectiveDesignations`). Its own module because only
// lazy chunks call it (Quick Plot's per-series-X seed, the Quick Figure
// Builder's first mapping, the import notice); the eager default-plot rule in
// lib/errorbars.ts's `bookDefaultHiddenChannels` applies the same test inline.

import type { OriginDesignation } from "./columnmeta";

/** Origin's nearest-preceding-X rule (`opj_curves.py`): each Y channel that
 *  has a designated X VALUE column before it, mapped to that column. A Y
 *  with no X column before it plots against the book's first X (`.time`)
 *  and is absent here. An undesignated channel counts as a Y, as a new
 *  column does in Origin (a computed column, or plain data after a user's
 *  "Set As X"). */
export function ownXSeries(designations: readonly (OriginDesignation | undefined)[]): Record<number, number> {
  const out: Record<number, number> = {};
  let lastX = -1;
  designations.forEach((d, c) => {
    if (d === "X") lastX = c;
    else if (lastX >= 0 && (d === "Y" || d === undefined)) out[c] = lastX;
  });
  return out;
}

/** True when value channel `c` holds at least one finite number. A column
 *  Origin keeps but never filled (a template's spare Y columns) has none: it
 *  is not a curve, so it is neither offered as one nor counted in the
 *  "belongs to another X" notice -- it would only add an empty legend row. */
export function hasFiniteValue(values: readonly (readonly number[])[], c: number): boolean {
  return values.some((row) => Number.isFinite(row?.[c]));
}
