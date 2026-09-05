// The worksheet cell-edit slice (MAIN_PLAN #34): write one cell, or a whole
// rectangular block, into a dataset's grid.
//
// Extracted out of useApp.ts under the store-size ratchet
// (architecture.test.ts's STORE_PINS), the same way store/corrections.ts and
// store/reimport.ts were: useApp.ts sits AT its pin with zero headroom, so a
// self-contained feature's actions live here rather than inline. Owns no state
// — `datasets` stays a plain field on the composed AppState and is mutated
// through `set`/`get`, the established pattern for a slice acting on shared
// state it does not own.
//
// COLUMN INDEXING: -1 is the x/time column, 0..n-1 are value channels.
// Computed (formula) columns are READ-ONLY in both actions — they are derived,
// so writing them would be overwritten on the next recompute anyway.
//
// P1.6b item 7 RULING (the "cell-edit guard" booked from the P1.4 review):
// `setCellValue`/`setCellBlock` take a raw numeric CODE, so their guard is
// necessarily numeric too — they REFUSE (zero mutation, `setStatus` names
// the reason) a non-NaN code that isn't an EXISTING level's index for a
// categorical column, rather than writing garbage a stray keystroke or a
// malformed paste produced. NaN always passes (it's the "missing" marker
// P1.4 already uses everywhere). `setCellBlock` applies the SAME rule
// per-cell, silently skipping just the offending cells — the same
// established shape this file already uses for read-only computed columns
// (`usable = edits.filter(...)` below), not a whole-block refusal: a block
// is usually a bulk paste where most cells are fine, and a bulk numeric
// paste of ALREADY-CODED categorical data is a legitimate power-user path
// this guard must not block wholesale.
//
// `setCategoricalCell` is the LEVEL-AWARE entry point the worksheet UI calls
// instead, for the interactive single-cell edit path: it takes a LABEL, not
// a code, and offers exactly the three honest options named in the review
// finding — (1) PICK an existing level (case-insensitive exact match), (2)
// EXTEND the level table with a genuinely new label (a deliberate one-undo-
// entry commit, never implicit), or (3) CLEAR to missing on blank input.
// There is no fourth "refuse" branch here for a non-blank label: unlike the
// numeric path (where an out-of-range code is ambiguous — typo? stale
// paste?), a typed LABEL is always resolvable to one of the first two
// options, so nothing is ever silently dropped.

import { isCategoricalChannel, categoricalLevels } from "../lib/categorical";
import { lit } from "../lib/macro";
import { dropRows, insertBlanks, patchCell, shiftForDelete, shiftForInsert } from "../lib/rowShift";
import { computeFormulasIncremental } from "../lib/formulaIncremental";
import { asAlreadyComputed } from "../lib/formulaInputs";
import { clearOverlaysFor } from "./corrections";
import type { CellEdit } from "../lib/clipboardGrid";
import type { Dataset } from "../lib/types";
import { recompute, type AppState } from "./useApp";

/** setCellValue/setCategoricalCell's fast path (PERF item, 2026-09): try the
 *  row-local INCREMENTAL recompute (lib/formulaIncremental.ts) — evaluating
 *  only `row` — before paying for a full, every-row `recompute`. `d` must
 *  already carry the edit in its BASE columns (both call sites patch those
 *  before calling this), the same shape `recompute`'s own
 *  `asAlreadyComputed` assertion requires. Falls back to the full
 *  `recompute` whenever the incremental path declines (an aggregate/lag/
 *  diff/recode formula, or one that already has an error — see
 *  formulaIncremental.ts's header) so correctness never depends on this
 *  fast path; setCellBlock (a multi-row paste) does not use this at all and
 *  always takes the full `recompute`. */
function recomputeAfterCellEdit(d: Dataset, row: number): Dataset {
  if (!d.formulas?.length) return d;
  const incremental = computeFormulasIncremental(asAlreadyComputed(d.data), d.formulas, [row], d.formulaErrors);
  if (!incremental) return recompute(d);
  return {
    ...d,
    data: incremental.data,
    formulaErrors: Object.keys(incremental.errors).length ? incremental.errors : undefined,
  };
}

/** Is `value` a code the categorical level table at `col` already has an
 *  entry for? NaN (missing) is handled by the CALLER, not here — this only
 *  judges a real, finite candidate code. */
function isValidExistingCode(ds: Dataset, col: number, value: number): boolean {
  if (col < 0 || !isCategoricalChannel(ds.data, col)) return true; // guard doesn't apply
  const levels = categoricalLevels(ds.data, col)!;
  return Number.isInteger(value) && value >= 0 && value < levels.length;
}

export interface CellEditSlice {
  setCellValue: (id: string, row: number, col: number, value: number) => void;
  /** Apply MANY edits as ONE operation — one undo entry, one recompute, one
   *  macro line. As N setCellValue calls a paste would need N presses of
   *  Ctrl+Z to reverse, which is not an undo model anyone can use. */
  setCellBlock: (id: string, edits: readonly CellEdit[], label: string) => void;
  /** Insert `count` blank rows above row `at` (MAIN_PLAN #34). */
  insertRows: (id: string, at: number, count: number) => void;
  /** Delete the given rows (MAIN_PLAN #34). */
  deleteRows: (id: string, rows: readonly number[]) => void;
  /** P1.6b item 7: the level-aware categorical cell editor — see this file's
   *  header for the pick/extend/clear ruling. `label` is the typed text, not
   *  a code. No-ops (with a status message) on a non-categorical column. */
  setCategoricalCell: (id: string, row: number, col: number, label: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createCellEditSlice(set: SliceSet, get: SliceGet): CellEditSlice {
  return {
    insertRows: (id, at, count) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds || count <= 0) return;
      get().recordHistory("insert rows");
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const time = insertBlanks(d.data.time, at, count);
          const blankRow = () => d.data.labels.map(() => Number.NaN);
          const clamped = Math.max(0, Math.min(at, d.data.values.length));
          const values = [
            ...d.data.values.slice(0, clamped),
            ...Array.from({ length: count }, blankRow),
            ...d.data.values.slice(clamped),
          ];
          // REMAP rather than clear: an explicit insert knows exactly what
          // moved, so discarding the user's row exclusions would be needless
          // damage (unlike a trim, whose mapping is unrecoverable).
          const excluded = d.excludedRows
            ? shiftForInsert(d.excludedRows, at, count)
            : undefined;
          return recompute({
            ...d,
            data: { ...d.data, time, values },
            ...(excluded ? { excludedRows: excluded } : {}),
          });
        }),
        // Row COUNT changed, so any fit/peak/baseline/deriv curve for this
        // dataset is drawn against a grid that no longer exists.
        ...clearOverlaysFor(s, id),
      }));
      get().recordMacro(`Insert ${count} row(s) in ${ds.name}`, `qz.insertRows(${lit(ds.name)}, ${at}, ${count})`);
      get().touchDataset(id);
    },

    deleteRows: (id, rows) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds || rows.length === 0) return;
      const deleted = new Set(rows.filter((r) => r >= 0 && r < ds.data.time.length));
      if (deleted.size === 0) return;
      get().recordHistory("delete rows");
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const excluded = d.excludedRows ? shiftForDelete(d.excludedRows, deleted) : undefined;
          return recompute({
            ...d,
            data: {
              ...d.data,
              time: dropRows(d.data.time, deleted),
              values: dropRows(d.data.values, deleted),
            },
            ...(excluded ? { excludedRows: excluded } : {}),
          });
        }),
        ...clearOverlaysFor(s, id),
      }));
      get().recordMacro(`Delete ${deleted.size} row(s) from ${ds.name}`, `qz.deleteRows(${lit(ds.name)}, ${deleted.size})`);
      get().touchDataset(id);
    },
  setCellValue: (id, row, col, value) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    // Out-of-range/negative row guard (P1.6b self-review finding): must run
    // BEFORE recordHistory, and before any patch — a `.slice()`-based patch
    // (below) throws on an out-of-range row rather than silently no-op'ing
    // the way the old `.map` patch did, and the time-column branch would
    // otherwise grow `time` into a sparse array via `time[row] = value` for
    // row >= time.length. Mirrors setCellBlock's own `e.row >= 0 && e.row <
    // ds.data.time.length` filter below.
    if (row < 0 || row >= ds.data.time.length) return;
    const baseCount = ds.data.labels.length - (ds.formulas?.length ?? 0);
    if (col >= baseCount) return; // computed column — read-only
    if (Number.isFinite(value) && !isValidExistingCode(ds, col, value)) {
      const levels = categoricalLevels(ds.data, col)!;
      get().setStatus(
        `${value} is not a valid level code for "${ds.data.labels[col]}" (0..${levels.length - 1}). ` +
          `Use the level picker, or Recode to add a new level.`,
      );
      return;
    }
    get().recordHistory("cell edit");
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        // Row-indexed patch (matches setCellBlock's shape below): one new
        // outer array, one new row array — not a full-array `.map` over
        // every row to change the one that's touched.
        let data;
        if (col < 0) {
          const time = d.data.time.slice();
          time[row] = value;
          data = { ...d.data, time };
        } else {
          data = { ...d.data, values: patchCell(d.data.values, row, col, value) };
        }
        return recomputeAfterCellEdit({ ...d, data }, row);
      }),
    }));
    get().recordMacro(
      `Edit ${ds.name} [${row},${col}]`,
      `qz.setCell(${lit(ds.name)}, ${row}, ${col}, ${lit(value)})`,
    );
    get().touchDataset(id); // recalc graph (#1): data changed
  },
  setCellBlock: (id, edits, label) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds || edits.length === 0) return;
    // Computed columns are read-only, exactly as in setCellValue above. The
    // pure layer (lib/clipboardGrid) already filters them out, but a block
    // arriving from anywhere else must not be able to bypass the rule.
    const baseCount = ds.data.labels.length - (ds.formulas?.length ?? 0);
    // P1.6b item 7: same guard as setCellValue, applied per-cell — a bulk
    // paste that hits a categorical column drops just the invalid cells
    // (matching the pre-existing computed-column/out-of-range filter here),
    // not the whole block. Adversarial review P2: unlike setCellValue,
    // this used to drop cells with ZERO feedback — a paste spanning
    // categorical + numeric columns could silently lose cells with no clue
    // why. `skipped` reports a count either way (partial or total refusal),
    // matching setCellValue's "name the reason" voice rather than staying
    // quiet — the SAME honesty fix covers the pre-existing computed-column
    // silence too, since both reasons fold into one filter/one count.
    const usable = edits.filter(
      (e) =>
        e.col < baseCount &&
        e.row >= 0 &&
        e.row < ds.data.time.length &&
        (!Number.isFinite(e.value) || isValidExistingCode(ds, e.col, e.value)),
    );
    const skipped = edits.length - usable.length;
    if (usable.length === 0) {
      if (skipped > 0) {
        get().setStatus(
          `${label}: nothing pasted — all ${skipped} cell${skipped === 1 ? "" : "s"} were read-only/out-of-range or not a valid level code for a categorical column.`,
        );
      }
      return;
    }
    get().recordHistory(label);
    // Index by row so the map below is O(rows + edits) rather than
    // O(rows x edits) — a paste can be thousands of cells and this runs on the
    // UI thread.
    const byRow = new Map<number, { col: number; value: number }[]>();
    for (const e of usable) {
      const list = byRow.get(e.row);
      if (list) list.push({ col: e.col, value: e.value });
      else byRow.set(e.row, [{ col: e.col, value: e.value }]);
    }
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const time = d.data.time.slice();
        const values = d.data.values.map((r) => r.slice());
        for (const [row, cells] of byRow) {
          for (const { col, value } of cells) {
            if (col < 0) time[row] = value;
            else values[row][col] = value;
          }
        }
        return recompute({ ...d, data: { ...d.data, time, values } });
      }),
    }));
    get().recordMacro(`${label} on ${ds.name}`, `qz.setCells(${lit(ds.name)}, ${usable.length})`);
    get().touchDataset(id);
    if (skipped > 0) {
      get().setStatus(
        `${label}: pasted ${usable.length} cell${usable.length === 1 ? "" : "s"}, skipped ${skipped} (read-only/out-of-range or not a valid level code for a categorical column).`,
      );
    }
  },
  setCategoricalCell: (id, row, col, label) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    // Same out-of-range/negative row guard as setCellValue above, and for
    // the same reason — BEFORE recordHistory, before the `.slice()`-based
    // patch that would otherwise throw on `values[row]`.
    if (row < 0 || row >= ds.data.time.length) return;
    const baseCount = ds.data.labels.length - (ds.formulas?.length ?? 0);
    if (col < 0 || col >= baseCount) return; // x column and computed columns aren't categorical cells
    const levels = categoricalLevels(ds.data, col);
    if (!levels) {
      get().setStatus(`"${ds.data.labels[col]}" isn't a categorical column.`);
      return;
    }
    const text = label.trim();
    let code: number;
    if (text === "") {
      code = Number.NaN; // clear to missing — always allowed, never a refusal
    } else {
      const existing = levels.findIndex((l) => l.toLowerCase() === text.toLowerCase());
      code = existing >= 0 ? existing : levels.length; // pick existing, or extend the table
      // Adversarial review P2: this is the "+ Add new level…" TYPED path —
      // a case-insensitive match here is the CORRECT call (no near-
      // duplicate "fail"/"Fail" pair created) but was silent, so a user who
      // typed expecting a genuinely new level had no sign it didn't happen.
      // An EXACT-case match isn't a surprise (that's the ordinary "you
      // retyped what's already there" case), so it says nothing extra.
      if (existing >= 0 && levels[existing] !== text) {
        get().setStatus(`Matched existing level "${levels[existing]}" (case-insensitive) — no new level added.`);
      }
    }
    get().recordHistory("cell edit");
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const extending = code === levels.length;
        // Same row-indexed patch as setCellValue above.
        const values = patchCell(d.data.values, row, col, code);
        const data = extending
          ? { ...d.data, values, cat_levels: { ...d.data.cat_levels, [col]: [...levels, text] } }
          : { ...d.data, values };
        return recomputeAfterCellEdit({ ...d, data }, row);
      }),
    }));
    get().recordMacro(
      `Edit ${ds.name} [${row},${col}] → ${label}`,
      `qz.setCategoricalCell(${lit(ds.name)}, ${row}, ${col}, ${lit(label)})`,
    );
    get().touchDataset(id);
  },
  };
}
