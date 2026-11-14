// Origin's nearest-preceding-X rule over a book's EFFECTIVE designations
// (lib/columnmeta.ts's `effectiveDesignations`). Its own module because only
// lazy chunks call it (Quick Plot's per-series-X seed, the Quick Figure
// Builder's first mapping, the import notice); the eager default-plot rule in
// lib/errorbars.ts's `bookDefaultHiddenChannels` applies the same test inline.

import { effectiveDesignations, type OriginDesignation } from "./columnmeta";
import type { Dataset } from "./types";

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

/** The X source channel `c` plots against under the same rule: its
 *  nearest-preceding X VALUE column, else the plot's base X. The base is the
 *  plot's `xKey` -- unless that is itself a designated X column, which owns
 *  only the channels after it, so a channel before every X keeps the book's
 *  first X (`.time`, null). Gap audit 2 #2: setting a later X as the plot X
 *  must never re-point an earlier Y onto it. */
export function seriesXKeyFor(
  designations: readonly (OriginDesignation | undefined)[],
  xKey: number | null,
  c: number,
): number | null {
  let lastX = -1;
  for (let i = 0; i < c && i < designations.length; i++) if (designations[i] === "X") lastX = i;
  if (lastX >= 0) return lastX;
  return xKey !== null && designations[xKey] === "X" ? null : xKey;
}

/** `seriesXKeyFor` over a dataset's effective designations: the X column (null
 *  = `.time`) curve `c` belongs to when the plot's X is `xKey`. Analysis reads
 *  a curve's X through this, so it fits/integrates the pairs the plot draws. */
export function curveXKey(ds: Pick<Dataset, "data" | "columnDesignations">, xKey: number | null, c: number): number | null {
  return seriesXKeyFor(effectiveDesignations(ds.data, ds.columnDesignations), xKey, c);
}
