// App-wide edit undo/redo (MAIN_PLAN #9, GUI_INTERACTION_PLAN #1): snapshots with structural
// sharing, NOT inverse patches. The Zustand store updates immutably, so
// capturing a reference to the previous `datasets` array (plus the sibling
// "library" fields a data-mutating action can touch) is nearly free — old
// snapshots share array/object structure with the live state, nothing is
// deep-cloned. Composed into the ONE useApp store instance exactly like
// ./windows (read its header first): `useApp` spreads
// `createHistorySlice(set)` into the store, so every existing
// `useApp((s) => ...)` selector and `useApp.getState()` call keeps working —
// this file is a code boundary, not a second store.
//
// What participates: scientific data edits, library/folder organization,
// saved graph specifications, persistent PlotView styling/objects, and plot
// window layout. Each user gesture records once at its boundary. Zoom/pan
// limits use a separate back/forward view history so Ctrl+Z stays predictable.
// The original data-only call sites include every
// call site in useApp.ts that opens with `get().recordHistory("label")` —
// worksheet cell edits + formula add/remove, dataset add/remove/remove-all/
// rename/duplicate/reorder/tag/group/notes edits (a merge or an append-
// import routes through `addDataset`, so it's covered by that one call
// site), corrections apply/reset, row exclusion changes + clear, channel
// role/type changes. Preferences and transient tool/selection state remain
// excluded.
//
// Snapshot shape: the persistent fields participating actions actually
// mutate — `datasets`, `activeId`, `selectedIds`, `worksheetId`,
// `originFigures`, `reports`, `figureDocs`, folder/spec collections,
// `plotWindows`, and the live PlotView. A window bound to a dataset that an
// undo just removed is
// guarded below (`restorePatch` nulls it, the same treatment
// `removeDataset` gives a live binding going forward), so a restored state
// never shows a dangling reference, only the existing "no dataset" empty
// state.
//
// Known limitation (by design, not a bug): undo does not cancel an
// in-flight recalc/fit job — the job resolves against whatever state exists
// when its promise settles, exactly like any other external mutation racing
// the store.

import { hydrateView, snapshotView, type PlotView } from "../lib/plotview";
import { focusTransientReset } from "./windows";
import type { AppState } from "./useApp";

/** Bounded stack depth — oldest entries evicted first (both directions, for
 *  symmetry; redo can never exceed how many entries were ever undone from a
 *  present history, so this is a defensive cap, not a load-bearing one). */
const HISTORY_DEPTH = 50;

/** The undoable slice of AppState — see the module doc for why this exact
 *  field list and no more. */
export interface HistorySnapshot {
  datasets: AppState["datasets"];
  activeId: AppState["activeId"];
  selectedIds: AppState["selectedIds"];
  worksheetId: AppState["worksheetId"];
  originFigures: AppState["originFigures"];
  originFidelity: AppState["originFidelity"];
  reports: AppState["reports"];
  figureDocs: AppState["figureDocs"];
  folders: AppState["folders"];
  smartFolders: AppState["smartFolders"];
  savedPlotSpecs: AppState["savedPlotSpecs"];
  activePlotSpecId: AppState["activePlotSpecId"];
  plotWindows: AppState["plotWindows"];
  focusedWindowId: AppState["focusedWindowId"];
  view: PlotView;
}

export interface HistoryEntry {
  /** Shown by the Edit menu / ⌘K as "Undo <label>" / "Redo <label>". */
  label: string;
  snapshot: HistorySnapshot;
}

export interface ViewSnapshot {
  xLim: [number, number] | null;
  yLim: [number, number] | null;
}

export interface ViewHistoryEntry {
  before: ViewSnapshot;
  after: ViewSnapshot;
}

function snapshotOf(s: AppState): HistorySnapshot {
  return {
    datasets: s.datasets,
    activeId: s.activeId,
    selectedIds: s.selectedIds,
    worksheetId: s.worksheetId,
    originFigures: s.originFigures,
    originFidelity: s.originFidelity,
    reports: s.reports,
    figureDocs: s.figureDocs,
    folders: s.folders,
    smartFolders: s.smartFolders,
    savedPlotSpecs: s.savedPlotSpecs,
    activePlotSpecId: s.activePlotSpecId,
    plotWindows: s.plotWindows,
    focusedWindowId: s.focusedWindowId,
    view: snapshotView(s),
  };
}

/** Post-restore guards (both `undo` and `redo` apply these): restore the
 *  snapshot's fields verbatim, drop a row selection that no longer names a
 *  live dataset, null any window's dataset binding that no longer exists in
 *  the restored library (mirrors `removeDataset`'s own going-forward
 *  treatment — see the module doc), and clear transient tool/gadget/overlay
 *  state exactly as a dataset switch does (`focusTransientReset`, reused
 *  verbatim from the windows slice — the same set `setActive`/
 *  `focusWindow`/`closeWindow` already clear on any underlying-data swap). */
function restorePatch(s: AppState, snap: HistorySnapshot): Partial<AppState> {
  const live = new Set(snap.datasets.map((d) => d.id));
  return {
    ...snap,
    ...hydrateView(snap.view),
    selection: s.selection && live.has(s.selection.datasetId) ? s.selection : null,
    plotWindows: snap.plotWindows.map((w) =>
      w.datasetId && !live.has(w.datasetId) ? { ...w, datasetId: null } : w,
    ),
    ...focusTransientReset(),
  };
}

export interface HistorySlice {
  history: HistoryEntry[];
  future: HistoryEntry[];
  /** Push the CURRENT state onto the undo stack under `label` and clear
   *  redo (any newly-recorded action invalidates whatever was undone).
   *  Call this at the very top of a participating mutation, BEFORE its own
   *  `set()`, so the pushed snapshot is the PRE-mutation state. */
  recordHistory: (label: string) => void;
  /** No-op on an empty stack (callers that want a "nothing to undo" toast
   *  check `history.length` themselves — see components/history). */
  undo: () => void;
  redo: () => void;
  viewHistory: ViewHistoryEntry[];
  viewFuture: ViewHistoryEntry[];
  recordView: (before: ViewSnapshot, after: ViewSnapshot) => void;
  backView: () => void;
  forwardView: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createHistorySlice(set: SliceSet): HistorySlice {
  return {
    history: [],
    future: [],
    viewHistory: [],
    viewFuture: [],
    recordHistory: (label) =>
      set((s) => ({
        history: [...s.history, { label, snapshot: snapshotOf(s) }].slice(-HISTORY_DEPTH),
        future: [],
      })),
    undo: () =>
      set((s) => {
        const top = s.history[s.history.length - 1];
        if (!top) return {};
        return {
          history: s.history.slice(0, -1),
          future: [...s.future, { label: top.label, snapshot: snapshotOf(s) }].slice(-HISTORY_DEPTH),
          status: `Undid ${top.label}`,
          ...restorePatch(s, top.snapshot),
        };
      }),
    redo: () =>
      set((s) => {
        const top = s.future[s.future.length - 1];
        if (!top) return {};
        return {
          future: s.future.slice(0, -1),
          history: [...s.history, { label: top.label, snapshot: snapshotOf(s) }].slice(-HISTORY_DEPTH),
          status: `Redid ${top.label}`,
          ...restorePatch(s, top.snapshot),
        };
      }),
    recordView: (before, after) =>
      set((s) => {
        if (
          before.xLim?.[0] === after.xLim?.[0] && before.xLim?.[1] === after.xLim?.[1] &&
          before.yLim?.[0] === after.yLim?.[0] && before.yLim?.[1] === after.yLim?.[1] &&
          (before.xLim === null) === (after.xLim === null) &&
          (before.yLim === null) === (after.yLim === null)
        ) return {};
        return {
          viewHistory: [...s.viewHistory, { before, after }].slice(-HISTORY_DEPTH),
          viewFuture: [],
          xLim: after.xLim,
          yLim: after.yLim,
          xStep: null,
          yStep: null,
          status: "Plot view changed",
        };
      }),
    backView: () =>
      set((s) => {
        const entry = s.viewHistory[s.viewHistory.length - 1];
        if (!entry) return {};
        return {
          viewHistory: s.viewHistory.slice(0, -1),
          viewFuture: [...s.viewFuture, entry].slice(-HISTORY_DEPTH),
          xLim: entry.before.xLim,
          yLim: entry.before.yLim,
          xStep: null,
          yStep: null,
          status: "Back to previous plot view",
        };
      }),
    forwardView: () =>
      set((s) => {
        const entry = s.viewFuture[s.viewFuture.length - 1];
        if (!entry) return {};
        return {
          viewFuture: s.viewFuture.slice(0, -1),
          viewHistory: [...s.viewHistory, entry].slice(-HISTORY_DEPTH),
          xLim: entry.after.xLim,
          yLim: entry.after.yLim,
          xStep: null,
          yStep: null,
          status: "Forward to next plot view",
        };
      }),
  };
}
