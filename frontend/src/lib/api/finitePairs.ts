// The NaN/±Infinity boundary for an (x, y) SERIES sent to a backend route —
// the API-request-path sibling of `lib/nonFiniteCells.ts` (BUG-017), which
// solved the same `JSON.stringify` loss for `.dwk` save, autosave, Pack
// Project and the clipboard package but never covered an HTTP request body.
//
// THE LOSS. `JSON.stringify(Number.NaN)` is `null`, and every calc route
// declares its series as pydantic `list[float]`, which REJECTS `null` — one
// `float_type` validation error per bad element. A measured M(H) loop with
// four gaps therefore produced a 422 carrying exactly four entries (BUG-021).
//
// WHY DROP RATHER THAN SEND. A gap in a measured loop is MISSING DATA, not a
// zero. The two candidate contracts were (a) teach the backend to accept and
// ignore non-finite entries, and (b) drop the gap rows here and put them back
// afterwards. (b) is what this module does, for three reasons:
//
//   1. A fit must never see an invented value. Dropping the row is the only
//      encoding under which `np.polyfit` cannot be handed a stand-in — a
//      sentinel or a `null`-to-0 coercion would silently pull the background
//      toward the origin, which is the exact class of quiet scientific error
//      BUG-021 is about.
//   2. ROW ALIGNMENT IS PRESERVED BY CONSTRUCTION. `dropGapRows` records the
//      ORIGINAL row index of every pair it kept; `restoreGapRows` scatters the
//      backend's result back to those indices and leaves `NaN` everywhere
//      else. A gap goes in and the SAME gap comes out, at the same row, so
//      the corrected series still lines up with the dataset it came from.
//      `restoreGapRows` THROWS on a length mismatch rather than producing a
//      shifted array — a misaligned corrected column is worse than an error.
//   3. It needs no wire change. The request/response models, `schema.d.ts`
//      and every other caller of these routes are untouched.
//
// A row is dropped when EITHER coordinate is non-finite: a fit consumes the
// pair, so half a point is no point.

/** The finite subset of an (x, y) series, plus what is needed to undo the
 *  drop. `keep[i]` is the ORIGINAL row index of `x[i]`/`y[i]`. */
export interface FinitePairs {
  x: number[];
  y: number[];
  keep: number[];
  /** Original row count — the length `restoreGapRows` rebuilds. */
  n: number;
  /** True when nothing was dropped, i.e. `keep` is `0..n-1`. */
  complete: boolean;
}

/** Keep only the rows where BOTH coordinates are finite. `x` and `y` must be
 *  the same length; a shorter `y` is treated as having a gap at the missing
 *  rows (its `undefined` is not finite), never silently zero-filled. */
export function dropGapRows(x: readonly number[], y: readonly number[]): FinitePairs {
  const n = x.length;
  const keptX: number[] = [];
  const keptY: number[] = [];
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    keptX.push(xi);
    keptY.push(yi);
    keep.push(i);
  }
  return { x: keptX, y: keptY, keep, n, complete: keep.length === n };
}

/** Scatter a backend result computed over `pairs.x`/`pairs.y` back onto the
 *  ORIGINAL rows: `values[i]` lands at row `pairs.keep[i]`, and every dropped
 *  row is `NaN` (the gap it was). A `null` element — what
 *  `routes/_payload.to_jsonable` writes for a non-finite result — decodes to
 *  `NaN` as well.
 *
 *  Throws when `values` is not one entry per kept row: that means the route
 *  did not return one result per input point, and scattering it anyway would
 *  put corrected values on the wrong rows. */
export function restoreGapRows(
  values: readonly (number | null)[],
  pairs: Pick<FinitePairs, "keep" | "n">,
): number[] {
  if (values.length !== pairs.keep.length) {
    throw new Error(
      `backend returned ${values.length} points for ${pairs.keep.length} sent — cannot align to the original rows`,
    );
  }
  const out = new Array<number>(pairs.n).fill(Number.NaN);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[pairs.keep[i]] = v == null ? Number.NaN : v;
  }
  return out;
}

// The ELEMENTWISE case (`substituteGaps` / `restoreSubstituted`, for
// row-independent transforms such as a unit conversion) lives in
// lib/api/finiteSubstitute.ts: only the lazy magnetometry tools call it
// (bundle diet slice 24). Import it by that path; this file does not
// re-export it.
