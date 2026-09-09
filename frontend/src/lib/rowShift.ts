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

/** Grow a column to `rows` entries with `fill`, or return it unchanged when it
 *  is already that long (never truncates).
 *
 *  Why a ragged dataset needs this (the Group N review's findings 3 and 4): a
 *  DataStruct's numeric grid and its row-indexed metadata sidecars can carry
 *  DIFFERENT row counts — a text-only Origin book is `time: []` with a full
 *  `text_columns` — while the worksheet's row domain is the MAX of the two
 *  (`useWorksheetView.ts`), so every row it shows is selectable. Clamping an
 *  edit against `time.length` in one half and the sidecar span in the other put
 *  the same inserted row at two different indices. Padding the numeric half up
 *  to the shared span first makes the grid rectangular, so one index means one
 *  row everywhere. The padding is only ever what the worksheet ALREADY renders
 *  for those rows (a blank), now made explicit. */
export function padRows<T>(column: readonly T[], rows: number, fill: T): T[] {
  if (column.length >= rows) return [...column];
  return [...column, ...Array.from({ length: rows - column.length }, () => fill)];
}

/** Drop `deleted` positions from a column. Returns a new array. */
export function dropRows<T>(column: readonly T[], deleted: ReadonlySet<number>): T[] {
  return column.filter((_, i) => !deleted.has(i));
}

/** Copy-on-write patch of one cell in a `values` grid: one new outer array,
 *  one new row array for `row` — not a full `.map` over every row. Shared by
 *  store/cellEdit.ts's setCellValue and setCategoricalCell (both used to
 *  duplicate this same four-line block). Callers own the row-range check —
 *  this indexes `values[row]` unconditionally, so `row` must already be
 *  known in bounds. */
export function patchCell(
  values: readonly (readonly number[])[],
  row: number,
  col: number,
  value: number,
): number[][] {
  const next = values.slice() as number[][];
  const patched = next[row].slice();
  patched[col] = value;
  next[row] = patched;
  return next;
}
