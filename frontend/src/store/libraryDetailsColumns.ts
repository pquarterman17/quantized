// PR L slice 2 (LIBRARY_WORKBOOK_UX_PLAN, L0.56): persists the Details
// view's selected metadata columns into `.dwk` — booked at slice 1 as
// "deferred to a later slice: .dwk-persisting the Details column selection
// itself". A standalone slice file (useApp.ts's near-zero line-budget
// headroom, the store/collections.ts / store/quickPlotTemplates.ts
// convention) composed into useApp.ts exactly like those: 2 import lines,
// 1 extends-union entry, 1 creator-spread line, plus the one `loadWorkspace`
// reset line every additive `.dwk` field needs (the same line
// `collections`/`quickPlotTemplates` needed when THEY were added — see
// lib/workspace.ts's WorkspaceState doc for the four-site pattern this
// mirrors).
//
// View preference, not an undoable edit — same class as `librarySelection`/
// `expandedWorkbookIds`/`workbookLastChild` (architecture.test.ts's
// HISTORY_EXCLUDED), so it is deliberately absent from store/history.ts's
// HistorySnapshot: toggling a column visible/hidden should never eat a
// Ctrl+Z step meant for an actual data edit.

import { defaultVisibleDetailsColumnKeys, type LibraryDetailsColumnKey } from "../lib/libraryDetailsColumns";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export interface LibraryDetailsColumnsSlice {
  /** The Details view's selected metadata columns (Name is always shown,
   *  separately — see lib/libraryDetailsColumns.ts's `NAME_COLUMN`).
   *  Round-trips through `.dwk` (additive-optional; absent = today's
   *  seven-column default). */
  visibleDetailsColumns: LibraryDetailsColumnKey[];
  /** Toggle one column on/off. No-op for an unrecognized key (defensive —
   *  the picker UI only ever offers a known key). */
  toggleVisibleDetailsColumn: (key: LibraryDetailsColumnKey) => void;
}

export function createLibraryDetailsColumnsSlice(set: SliceSet): LibraryDetailsColumnsSlice {
  return {
    visibleDetailsColumns: defaultVisibleDetailsColumnKeys(),
    toggleVisibleDetailsColumn: (key) =>
      set((s) => ({
        visibleDetailsColumns: s.visibleDetailsColumns.includes(key)
          ? s.visibleDetailsColumns.filter((k) => k !== key)
          : [...s.visibleDetailsColumns, key],
      })),
  };
}
