// Wires a dataset's hidden/frozen columns (lib/worksheetColumnView.ts) to the
// store commands (store/worksheetColumnView.ts — one undo step each) and to the
// menu controls (./columnViewMenu.ts). Kept out of useWorksheetView, which is
// already over its size budget.

import { useMemo } from "react";

import type { Dataset } from "../../../lib/types";
import { hideColumns, setFrozenColumns, showColumns } from "../../../store/worksheetColumnView";
import type { ColumnViewControls } from "./columnViewMenu";

const NONE: readonly number[] = [];

export interface ColumnVisibility {
  /** The set the grid and the cursor read (stable while the list is). */
  hiddenSet: ReadonlySet<number>;
  frozen: number;
  controls: ColumnViewControls;
}

export function useColumnVisibility(ds: Dataset, selectedCols: ReadonlySet<number>, clearColSelection: () => void): ColumnVisibility {
  const hidden = ds.hiddenCols ?? NONE;
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const frozen = ds.frozenCols ?? 0;
  const id = ds.id;
  const labels = ds.data.labels;
  const selected = useMemo(() => [...selectedCols].filter((c) => c >= 0).sort((a, b) => a - b), [selectedCols]);
  const controls: ColumnViewControls = {
    labels,
    hidden,
    frozen,
    selected,
    hide: (cols) => {
      hideColumns(id, cols);
      clearColSelection(); // a hidden column must not stay selected for plot/delete
    },
    show: (cols) => showColumns(id, cols),
    freezeThrough: (col) => setFrozenColumns(id, col + 1),
    unfreeze: () => setFrozenColumns(id, 0),
  };
  return { hiddenSet, frozen, controls };
}

/** The column selection minus hidden columns — the ONE place the filter lives,
 *  so a shift-range across a hidden column, or an undo that re-hides a selected
 *  one, never carries it into delete / plot / block ops the user cannot see. */
export function useShownSelection(picked: Set<number>, hidden: readonly number[] | undefined): Set<number> {
  return useMemo(() => (hidden?.length ? new Set([...picked].filter((c) => !hidden.includes(c))) : picked), [picked, hidden]);
}
