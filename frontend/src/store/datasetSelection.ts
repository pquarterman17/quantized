// DATASET SELECTION + ACTIVATION, extracted from store/useApp.ts (audit P4.1,
// the eighth domain — "decompose high-risk frontend god-modules,
// characterization tests first"; store-size ratchet, MAIN_PLAN #2). Composed
// into the ONE useApp store exactly like ./datasetListEdits: `useApp` spreads
// `createDatasetSelectionSlice(set, get)` into the store, so every existing
// `useApp((s) => s.activeId)` selector and `getState().setActive(id)` call
// keeps working. A code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: which dataset is active (plotted in the focused
// window), which rows are multi-selected, and the Worksheet tab's override —
// the `activeId`, `selectedIds` and `worksheetId` fields, declared and
// initialized HERE (an own-state slice, store/gadget.ts's shape) — plus the
// five actions that move them: `setActive`, `activateFromLibrary`,
// `toggleSelected`, `selectRange`, `selectIds`.
//
// Not exclusive write access: nearly every slice writes these fields as part
// of its own gesture (addDataset, removals, imports, splits, a .dwk load,
// undo/redo). This module owns the gestures whose whole job is selection.
//
// Cross-slice reach: `setActive` is the plot-intent primitive, so it rebinds
// the FOCUSED window through the windows slice's shared helpers —
// `retargetPassiveRebind` (a pinned focused window hands the rebind to
// another window, or a fresh one) then `focusedRebindPatch` (the rebind
// itself, shared verbatim with `rebindWindow`'s explicit-drop path). Both
// live in ./windows; this module only calls them.
//
// Contract: none of the five records its own undo step, toasts or records a
// macro step (the pinned-window path's `createWindow` pushes ITS "create
// window" step). `setActive` and the worksheet-intent branch of
// `activateFromLibrary` kick `ensureBookData` for the id (single-flight).
// The three selection actions never move `activeId`. Every action except a
// `selectIds` that leaves nothing selected exits the Library tree's
// folder/workbook selection (`librarySelection: null`, L0.25).
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React. Runtime
// imports are ../lib/grouping and ./windows only; ./useApp is TYPE-only, so
// the runtime import graph stays one-directional (useApp -> here -> windows).
//
// Characterization tests: store/datasetSelection.characterization.test.ts
// pins the exact keys every action writes (a poisoned whole-getState() diff),
// the window effects, the undo/toast/macro silence and the ensureBookData
// kicks. Written green against the pre-extraction useApp.ts and unchanged by
// the move.

import { isOriginBookDataset } from "../lib/grouping";
import type { AppState } from "./useApp";
import { focusedRebindPatch, retargetPassiveRebind } from "./windows";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface DatasetSelectionSlice {
  activeId: string | null;
  // Multi-selection for bulk ops (Delete key). `activeId` stays the plotted
  // "primary"; ctrl/shift-click extend `selectedIds` without changing the plot.
  selectedIds: string[];
  // WORKSHEET_PLAN item 15 ("origin book click opens…"): the Worksheet tab's
  // dataset override, set by `activateFromLibrary`'s worksheet-intent path
  // instead of `activeId` — `activeId` stays the FOCUSED plot window's bound
  // dataset (PlotStage/Inspector/every workshop MUST keep reading it
  // unchanged, per MULTI_PLOT_PLAN's facade). null = "no override"
  // (`Worksheet.tsx` falls back to `activeId`); `setActive` clears it.
  worksheetId: string | null;

  setActive: (id: string) => void;
  // WORKSHEET_PLAN item 15: the routed Library-click entry point — EVERY
  // "click/select a row" site (DatasetRow's plain click + pre-menu select,
  // the Library arrow-key nav, the worksheet's own sheet/book-switcher tabs)
  // calls THIS, never `setActive` directly, so they all honor the
  // `originBookClickOpens` preference the same way. Routes to a worksheet-
  // intent path (sets `worksheetId`, switches to the Worksheet tab, leaves
  // the focused plot window and its view untouched) for an Origin-project
  // dataset when the pref is "worksheet" (default); falls through to
  // `setActive` (unconditional plot-intent) for every non-Origin dataset,
  // and for an Origin one when the pref is "plot". `setActive` itself stays
  // the unconditional plot-intent primitive on purpose — explicit "Plot
  // (make active)", figure apply, and the worksheet's own Plot-selection/
  // Add-to-plot rebind (`lib/selectionplot` via `useWorksheetView.plotCols`)
  // all call it directly.
  activateFromLibrary: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectRange: (id: string) => void;
  // Replace the multi-selection with an explicit id list (folder bulk ops,
  // item 8) — like ctrl-click, it never moves the plotted/active dataset.
  selectIds: (ids: string[]) => void;
}

export function createDatasetSelectionSlice(set: SliceSet, get: SliceGet): DatasetSelectionSlice {
  return {
    activeId: null,
    worksheetId: null,
    selectedIds: [],

    setActive: (id) => {
      // Item 14 pin opt-out: a pinned focused window never follows a passive
      // plot intent — retarget it first (focus swap, or a fresh window), then
      // the normal focused-window rebind below lands on the new focus. The
      // rebind itself lives in `focusedRebindPatch` (hoisted, module level) so
      // `rebindWindow`'s explicit-drop path shares it verbatim.
      retargetPassiveRebind(get(), id);
      set((s) => focusedRebindPatch(s, id));
      // ORIGIN_FILE_DECODE_PLAN #38: a plain click covers the common "activate
      // a lazy book" path; the render-side hooks (PlotStage/WindowCanvas/
      // MultiPanelStage/WorksheetPane) cover the rest (multi-panel siblings,
      // whatever `addDataset` left active after a bulk import, a .dwk reload).
      get().ensureBookData(id);
    },
    // WORKSHEET_PLAN item 15 ("origin book click opens…" — owner: "clicking the
    // books tries to plot it all rather than open a spreadsheet like in
    // Origin"). An Origin-project dataset (`isOriginBookDataset`) routes to a
    // worksheet-intent activation — under the default pref: just switches the
    // Worksheet tab to `id` and collapses the row selection, WITHOUT touching
    // `activeId`, `plotWindows`, or any of the singleton view fields (Origin's
    // own model: opening a workbook never touches your graphs). Everything
    // else (a non-Origin dataset, or the pref set to "plot") falls through to
    // `setActive` — the unconditional plot-intent activation, unchanged.
    activateFromLibrary: (id) => {
      const s = get();
      const ds = s.datasets.find((d) => d.id === id);
      if (ds && isOriginBookDataset(ds) && s.originBookClickOpens === "worksheet") {
        set({
          worksheetId: id,
          selectedIds: [id], // plain click collapses the selection, same as setActive
          stageTab: "worksheet", librarySelection: null, // L0.25: also exits folder/workbook selection
        });
        // #38: WorksheetPane's own pending-effect covers the render-side
        // fetch once mounted; kick it here too (single-flight — harmless if
        // it's already in flight) so Library/Inspector consumers keying off
        // `pending` update without waiting for a mount.
        get().ensureBookData(id);
        return;
      }
      get().setActive(id);
    },
    // Ctrl/Cmd-click: add or remove a row from the multi-selection WITHOUT changing
    // the plotted/active dataset (the plot only follows a plain click).
    toggleSelected: (id) =>
      set((s) => ({
        selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
        librarySelection: null, // L0.25: also exits folder/workbook selection (selectRange/setActive do the same)
      })),
    // Shift-click: select the contiguous range from the anchor (activeId) to `id`
    // in library order. Doesn't move the active selection (the plot stays put).
    selectRange: (id) =>
      set((s) => {
        const order = s.datasets.map((d) => d.id);
        const anchor = s.activeId ?? id;
        const a = order.indexOf(anchor);
        const b = order.indexOf(id);
        if (a < 0 || b < 0) return { selectedIds: [id], librarySelection: null };
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return { selectedIds: order.slice(lo, hi + 1), librarySelection: null };
      }),
    // Explicit-list selection (folder "Select all" — item 8): de-duplicated and
    // clamped to live datasets; the plotted/active dataset stays put.
    selectIds: (ids) =>
      set((s) => {
        const live = new Set(s.datasets.map((d) => d.id));
        const selectedIds = [...new Set(ids)].filter((id) => live.has(id));
        // L0.25 coherence chokepoint (like activateFromLibrary/toggleSelected):
        // a live dataset selection displaces the tree's librarySelection.
        return { selectedIds, ...(selectedIds.length > 0 ? { librarySelection: null } : {}) };
      }),
  };
}
