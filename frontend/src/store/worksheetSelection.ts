// Per-worksheet-window row selection (GUI_INTERACTION_PLAN #14). Every MDI
// worksheet DOCUMENT window (MULTI_PLOT_PLAN item 17, `kind:"worksheet"`,
// created by `createDocumentWindow`/opened via `DocumentWindow.tsx`) gets its
// OWN independent row selection here, keyed by the window's id — including
// two windows bound to the SAME dataset (no shared slot, so interacting in
// one never moves a highlight in the other).
//
// This is DELIBERATELY separate from the legacy `selection` singleton in
// store/useApp.ts, which the Stage "Worksheet" TAB (components/Stage/
// Worksheet.tsx — not an MDI window, always tracks `worksheetId ?? activeId`)
// keeps using exactly as before. That singleton is the pre-existing,
// deliberate link to the live plot: composeDisplayPayload highlights the
// selected rows as plotted points, and PlotStage's onRangeSelect drag-brush
// writes back into it. A worksheet DOCUMENT window never touches that
// singleton (previously it read/wrote it too — the "N worksheet windows
// SHARE the row selection" bug this file fixes), so selecting rows in one can
// never surprise the live plot or any OTHER worksheet window. See
// useWorksheetView's `plotLinked` + WorksheetToolbar's "Linked to plot" badge
// for where the legacy singleton's link is made explicit in the UI.
//
// "Live" only while the stored entry's datasetId still matches the window's
// CURRENT dataset binding — mirrors the legacy singleton's identical guard —
// so a stale selection from before a rebind (dragging a different Library row
// onto the window) silently reads as empty instead of highlighting the wrong
// rows on the new dataset.

import type { AppState } from "./useApp";

export interface WorksheetSelectionSlice {
  worksheetSelections: Record<string, { datasetId: string; rows: number[] }>;
  toggleWorksheetRowSelected: (windowId: string, datasetId: string, row: number) => void;
  setWorksheetRowSelection: (windowId: string, datasetId: string, rows: number[]) => void;
  clearWorksheetRowSelection: (windowId: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

type SelectionMap = Record<string, { datasetId: string; rows: number[] }>;

/** Drop `windowId`'s entry (a no-op, same-reference return, when absent) —
 *  window close (item 17's `closeWindow`) and a document-window rebind
 *  (`rebindWindow`) both call this via store/windows.ts so a selection never
 *  outlives its window or survives pointing at the wrong dataset. */
export function dropWorksheetSelection(map: SelectionMap, windowId: string): SelectionMap {
  if (!(windowId in map)) return map;
  const next = { ...map };
  delete next[windowId];
  return next;
}

export function createWorksheetSelectionSlice(set: SliceSet): WorksheetSelectionSlice {
  return {
    worksheetSelections: {},
    toggleWorksheetRowSelected: (windowId, datasetId, row) =>
      set((s) => {
        const cur = s.worksheetSelections[windowId];
        const rows0 = cur?.datasetId === datasetId ? cur.rows : [];
        const rows = rows0.includes(row)
          ? rows0.filter((r) => r !== row)
          : [...rows0, row].sort((a, b) => a - b);
        return {
          worksheetSelections: rows.length
            ? { ...s.worksheetSelections, [windowId]: { datasetId, rows } }
            : dropWorksheetSelection(s.worksheetSelections, windowId),
        };
      }),
    setWorksheetRowSelection: (windowId, datasetId, rows) =>
      set((s) => {
        const clean = [...new Set(rows)].sort((a, b) => a - b);
        return {
          worksheetSelections: clean.length
            ? { ...s.worksheetSelections, [windowId]: { datasetId, rows: clean } }
            : dropWorksheetSelection(s.worksheetSelections, windowId),
        };
      }),
    clearWorksheetRowSelection: (windowId) =>
      set((s) => ({ worksheetSelections: dropWorksheetSelection(s.worksheetSelections, windowId) })),
  };
}
