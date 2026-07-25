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

import { lit } from "../lib/macro";
import type { CellEdit } from "../lib/clipboardGrid";
import { recompute, type AppState } from "./useApp";

export interface CellEditSlice {
  setCellValue: (id: string, row: number, col: number, value: number) => void;
  /** Apply MANY edits as ONE operation — one undo entry, one recompute, one
   *  macro line. As N setCellValue calls a paste would need N presses of
   *  Ctrl+Z to reverse, which is not an undo model anyone can use. */
  setCellBlock: (id: string, edits: readonly CellEdit[], label: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createCellEditSlice(set: SliceSet, get: SliceGet): CellEditSlice {
  return {
  setCellValue: (id, row, col, value) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    const baseCount = ds.data.labels.length - (ds.formulas?.length ?? 0);
    if (col >= baseCount) return; // computed column — read-only
    get().recordHistory("cell edit");
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const data =
          col < 0
            ? { ...d.data, time: d.data.time.map((t, i) => (i === row ? value : t)) }
            : {
                ...d.data,
                values: d.data.values.map((r, i) =>
                  i === row ? r.map((v, c) => (c === col ? value : v)) : r,
                ),
              };
        return recompute({ ...d, data });
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
    const usable = edits.filter(
      (e) => e.col < baseCount && e.row >= 0 && e.row < ds.data.time.length,
    );
    if (usable.length === 0) return;
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
  },
  };
}
