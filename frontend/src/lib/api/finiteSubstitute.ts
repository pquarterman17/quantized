// The ELEMENTWISE sibling of lib/api/finitePairs.ts (BUG-021), moved verbatim
// out of it in bundle diet slice 24: only the lazy magnetometry tools call
// it, so it ships with them instead of in the eager bundle. Import it by this
// path; finitePairs.ts does not re-export it (architecture.test.ts,
// DRAGGED_OUT).
//
// ── The ELEMENTWISE case ───────────────────────────────────────────────────
//
// `dropGapRows` is right for a FIT, where one invented value poisons the whole
// answer, and it necessarily pairs the two coordinates: a row is dropped when
// either is a gap. For a row-INDEPENDENT transform — a unit conversion is a
// scalar multiply per axis — that pairing throws away good data: a finite
// field value sitting on a row whose MOMENT is a gap would come back `NaN`
// even though nothing about it was missing.
//
// For those, substitute instead of drop. A finite placeholder is sent in each
// gap's place and its converted result is thrown away on the way back, which
// is exact precisely because no row can influence another. Never use this
// ahead of a fit, an average, an integral or anything else that reads more
// than one row at a time.

/** A series with every non-finite entry replaced by a finite placeholder, plus
 *  the mask saying which entries were real. */
export interface SubstitutedSeries {
  safe: number[];
  finite: boolean[];
}

export function substituteGaps(v: readonly number[]): SubstitutedSeries {
  const safe = new Array<number>(v.length);
  const finite = new Array<boolean>(v.length);
  for (let i = 0; i < v.length; i++) {
    const ok = Number.isFinite(v[i]);
    finite[i] = ok;
    safe[i] = ok ? v[i] : 0;
  }
  return { safe, finite };
}

/** Undo {@link substituteGaps}: keep the transformed value where the input was
 *  real, restore `NaN` where it was a gap. Throws on a length mismatch, for
 *  the same reason `restoreGapRows` does. */
export function restoreSubstituted(
  values: readonly (number | null)[],
  finite: readonly boolean[],
): number[] {
  if (values.length !== finite.length) {
    throw new Error(
      `backend returned ${values.length} points for ${finite.length} sent — cannot align to the original rows`,
    );
  }
  return values.map((v, i) => (finite[i] && v != null ? v : Number.NaN));
}
