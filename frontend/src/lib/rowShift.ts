// Row-index remapping for structural worksheet edits (MAIN_PLAN #34).
//
// Inserting or deleting rows changes what every stored row INDEX means. This
// repo has been bitten by that class four separate times (trimmed plots
// dropping full-length overlays, xTrim carrying stale exclusions, removeFormula
// hiding the wrong column, reimport keeping view-scoped state), so the rule
// here is: REMAP, do not clear.
//
// Clearing is the safe-but-lossy fallback the corrections pipeline uses,
// because a trim's before/after mapping is not recoverable from lengths alone.
// An explicit insert/delete DOES know exactly what moved, so throwing away a
// user's row exclusions would be needless damage.
//
// Pure and index-only: these functions never see a dataset.

/** Remap indices after inserting `count` rows at `at`.
 *
 *  An index AT the insertion point moves down — the new rows are inserted
 *  above it, which is what "insert at row 5" means to a spreadsheet user. */
export function shiftForInsert(
  indices: readonly number[],
  at: number,
  count: number,
): number[] {
  if (count <= 0) return [...indices];
  return indices.map((i) => (i >= at ? i + count : i));
}

/** Remap indices after deleting `deleted`.
 *
 *  A deleted index disappears (it no longer refers to anything); a surviving
 *  index moves up by however many deleted rows were ABOVE it. */
export function shiftForDelete(
  indices: readonly number[],
  deleted: ReadonlySet<number>,
): number[] {
  if (deleted.size === 0) return [...indices];
  const sortedDeleted = [...deleted].sort((a, b) => a - b);
  const out: number[] = [];
  for (const i of indices) {
    if (deleted.has(i)) continue; // the row itself is gone
    let below = 0;
    for (const d of sortedDeleted) {
      if (d < i) below++;
      else break;
    }
    out.push(i - below);
  }
  return out;
}

/** Insert `count` blank (NaN) rows into a column at `at`. Returns a new array;
 *  NaN is the same "missing" marker single-cell editing commits. */
export function insertBlanks(column: readonly number[], at: number, count: number): number[] {
  const clamped = Math.max(0, Math.min(at, column.length));
  return [
    ...column.slice(0, clamped),
    ...Array.from({ length: Math.max(0, count) }, () => Number.NaN),
    ...column.slice(clamped),
  ];
}

/** Drop `deleted` positions from a column. Returns a new array. */
export function dropRows<T>(column: readonly T[], deleted: ReadonlySet<number>): T[] {
  return column.filter((_, i) => !deleted.has(i));
}
