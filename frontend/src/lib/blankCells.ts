// A backend DataStruct's blank cells, restored to NaN at the transform commit
// boundary (audit P2.3 slice 2).
//
// The route layer writes every non-finite float as JSON `null`
// (`routes/_payload.py`), so a derived dataset straight off the wire carries
// `null` cells. In memory that draws fine (a gap), but the `.dwk` cell check
// deliberately REFUSES a `null` cell on reopen (`lib/nonFiniteCells.ts`: a
// pre-BUG-017 `null` is ambiguous), so a saved workspace holding such a
// dataset would not open again. A blank SIMS sample (a species outside its
// measured depth range, a normalization by a non-positive reference) and
// every blank of a comparison table's row blocks is a real "no value" — NaN,
// which `.dwk` round-trips as its `"NaN"` sentinel. Lazy-only: imported by
// the SIMS transforms, never by the eager chunk.

import type { DataStruct } from "./types";

const cell = (v: number | null): number => (v === null ? Number.NaN : v);

/** `data` with every `null` in `time`/`values` replaced by NaN (the same
 *  object when there is none, so an all-finite result is untouched). */
export function blanksToNaN(data: DataStruct): DataStruct {
  const t = data.time as (number | null)[];
  const v = data.values as (number | null)[][];
  const blank = t.includes(null) || v.some((row) => row.includes(null));
  if (!blank) return data;
  return { ...data, time: t.map(cell), values: v.map((row) => row.map(cell)) };
}
