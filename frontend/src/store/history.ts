// App-wide edit undo/redo (MAIN_PLAN #9, GUI_INTERACTION_PLAN #1): snapshots with structural
// sharing, NOT inverse patches. The Zustand store updates immutably, so
// capturing a reference to the previous `datasets` array (plus the sibling
// "library" fields a data-mutating action can touch) is nearly free — old
// snapshots share array/object structure with the live state, nothing is
// deep-cloned. Composed into the ONE useApp store instance exactly like
// ./windows (read its header first): `useApp` spreads
// `createHistorySlice(set, get)` into the store, so every existing
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
// Deliberately excluded: `mapRoi` and `mapRuler` — these are in-progress
// working geometry, not committed edits. They survive across dataset switches
// by design (the "repeat this cut on the next dataset" workflow), but they
// should never participate in the edit history; only named saved ROIs
// (`savedRois`) are persistent edits. See `store/rois.ts` for details.
//
// Known limitation (by design, not a bug): undo does not cancel an
// in-flight recalc/fit job — the job resolves against whatever state exists
// when its promise settles, exactly like any other external mutation racing
// the store.

import { hydrateView, navigationView, snapshotView, type PlotView } from "../lib/plotview";
import { focusTransientReset } from "./windows";
import type { AppState } from "./useApp";

/** Bounded stack depth — oldest entries evicted first (both directions, for
 *  symmetry; redo can never exceed how many entries were ever undone from a
 *  present history, so this is a defensive cap, not a load-bearing one). */
const HISTORY_DEPTH = 50;

/** The undoable slice of AppState — see the module doc for why this exact
 *  field list and no more.
 *
 *  CRITICAL: This is an **inclusion allowlist**, not a struct that tracks in
 *  parallel — any new persistent store field is SILENTLY OUTSIDE undo until
 *  added here AND in snapshotOf(). The `savedRois` field was forgotten for a
 *  day (2026-08-09–2026-08-10), making ROI deletions unrecoverable.
 *
 *  When adding a new field to AppState:
 *  1. Decide: does this field represent a **persistent user edit** that should
 *     survive Ctrl+Z, or is it **transient/UI-only** state?
 *  2. If persistent → add it here AND to snapshotOf() below.
 *  3. If transient → add it to the HISTORY_EXCLUDED list in
 *     frontend/src/architecture.test.ts with a clear justification comment —
 *     the test will verify the classification is exhaustive and intentional.
 *
 *  See store/rois.ts for the rationale behind excluding `mapRoi`/`mapRuler`
 *  (working geometry that survives dataset switches but not undo).
 */
export interface HistorySnapshot {
  datasets: AppState["datasets"];
  activeId: AppState["activeId"];
  selectedIds: AppState["selectedIds"];
  worksheetId: AppState["worksheetId"];
  originFigures: AppState["originFigures"];
  originFidelity: AppState["originFidelity"];
  reports: AppState["reports"];
  figureDocs: AppState["figureDocs"];
  editableFigures: AppState["editableFigures"];
  pages: AppState["pages"];
  folders: AppState["folders"];
  // Retrospective-audit fix (2026-08-15): `expandedFolders` round-trips into
  // `.dwk` v2 — it is persistent project data, not transient UI state like
  // `expandedWorkbookIds` (whose E2-owned exclusion is documented in
  // architecture.test.ts). `folderDeletePatch` prunes it under
  // recordHistory("delete folder"), and without this field an undone folder
  // delete restored the folder COLLAPSED — the exact half-restored-state
  // failure this file's header warns about (the savedRois incident).
  expandedFolders: AppState["expandedFolders"];
  // LIBRARY_WORKBOOK_UX_PLAN PR A2 — persistent Library organization, same
  // class as `folders` right above it (not yet mutated by any action; wired
  // here now so the FIRST mutating action in a later PR inherits undo for
  // free instead of repeating the `savedRois` omission this file's header warns about).
  workbooks: AppState["workbooks"];
  smartFolders: AppState["smartFolders"];
  savedPlotSpecs: AppState["savedPlotSpecs"];
  activePlotSpecId: AppState["activePlotSpecId"];
  savedRois: AppState["savedRois"];
  // LIBRARY_WORKBOOK_UX_PLAN PR H — named Quick Plot templates. Persistent
  // user edits (save/rename/delete), same class as `savedPlotSpecs`/
  // `savedRois` right above — wired here IN THE SAME COMMIT as the store
  // slice (store/quickPlotTemplates.ts) per this file's own savedRois-
  // incident gate, not as an afterthought.
  quickPlotTemplates: AppState["quickPlotTemplates"];
  // P1.3 wave 2 Lane B — named plot recipes (store/plotRecipes.ts). Persistent
  // user edits (save/rename/delete/duplicate; apply creates a figure, already
  // covered via `editableFigures`/`plotWindows` below), same class as
  // `quickPlotTemplates` right above — wired here in the SAME commit as the
  // store slice per this file's own savedRois-incident gate.
  plotRecipes: AppState["plotRecipes"];
  // LIBRARY_WORKBOOK_UX_PLAN PR L (L0.48/L0.49/L0.56) — Collection save/
  // rename/re-query/delete is an undoable project edit, same class as
  // `quickPlotTemplates`/`smartFolders` right above.
  collections: AppState["collections"];
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
    editableFigures: s.editableFigures,
    pages: s.pages,
    folders: s.folders,
    expandedFolders: s.expandedFolders,
    workbooks: s.workbooks,
    smartFolders: s.smartFolders,
    savedPlotSpecs: s.savedPlotSpecs,
    activePlotSpecId: s.activePlotSpecId,
    savedRois: s.savedRois,
    quickPlotTemplates: s.quickPlotTemplates,
    plotRecipes: s.plotRecipes,
    collections: s.collections,
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
  // Destructure `view` out: it is a nested field of the SNAPSHOT, not of
  // AppState, and spreading `snap` wholesale wrote an inert `state.view` onto
  // the live store on every undo/redo (harmless today, a silent clobber the
  // day AppState gains a real `view` field).
  const { view, ...fields } = snap;
  return {
    ...fields,
    ...hydrateView(view),
    // Then put the LIVE zoom/pan back. `hydrateView` restores every PlotView
    // field including the navigation ones, so without this an ordinary
    // Ctrl+Z ("undo add shape") also silently discarded a zoom performed
    // afterwards — and left the separate viewHistory/viewFuture stack
    // pointing at bounds that are no longer live. Navigation is undone with
    // Alt+left/right, edits with Ctrl+Z; this keeps that split intact.
    ...navigationView(s),
    selection: s.selection && live.has(s.selection.datasetId) ? s.selection : null,
    // L0.25 on undo/redo (hardening review fix — undo was a SEVENTH
    // invariant violator): the snapshot restores `selectedIds` verbatim, so
    // a non-empty restored dataset selection displaces the live tree
    // selection; and a surviving tree selection must still NAME something in
    // the restored state — undoing a folder's creation while it was selected
    // otherwise left a dangling id feeding import targeting.
    librarySelection: (() => {
      if (snap.selectedIds.length > 0) return null;
      const sel = s.librarySelection;
      if (!sel) return null;
      const alive =
        sel.kind === "folder" ? snap.folders.some((f) => f.id === sel.id)
        : sel.kind === "workbook" ? snap.workbooks.some((w) => w.id === sel.id)
        : sel.kind === "origin-figure" ? snap.originFigures.some((f) => f.id === sel.id)
        : sel.kind === "editable-figure" ? snap.editableFigures.some((f) => f.id === sel.id)
        : sel.kind === "publication-figure" ? snap.figureDocs.some((f) => f.id === sel.id)
        : sel.kind === "page" ? snap.pages.some((pg) => pg.id === sel.id)
        : snap.reports.some((r) => r.id === sel.id);
      return alive ? sel : null;
    })(),
    plotWindows: snap.plotWindows.map((w) =>
      w.datasetId && !live.has(w.datasetId) ? { ...w, datasetId: null } : w,
    ),
    ...focusTransientReset(),
  };
}

export interface HistorySlice {
  history: HistoryEntry[];
  future: HistoryEntry[];
  /** True while a `withHistoryBatch` batch is running — `recordHistory`
   *  becomes a no-op for its duration (see `withHistoryBatch`'s own doc).
   *  Session-only control state, not user data — HISTORY_EXCLUDED, same
   *  class as `history`/`future` themselves. Never set directly outside
   *  this module. */
  historySuppressed: boolean;
  /** Push the CURRENT state onto the undo stack under `label` and clear
   *  redo (any newly-recorded action invalidates whatever was undone).
   *  Call this at the very top of a participating mutation, BEFORE its own
   *  `set()`, so the pushed snapshot is the PRE-mutation state. A no-op
   *  while `historySuppressed` (inside a `withHistoryBatch`) — the batch
   *  owns pushing the one entry for the whole operation instead. */
  recordHistory: (label: string) => void;
  /** Run `fn` as ONE undo step, no matter how many ordinary
   *  `recordHistory("...")` calls happen inside it (store/relink.ts's
   *  `commit()` hand-rolled this exact shape for its own batch before this
   *  existed — see that module's doc; this generalizes it). Snapshots the
   *  PRE-batch state up front, suppresses every `recordHistory` call for
   *  `fn`'s duration, then — only if at least one suppressed call actually
   *  fired (i.e. `fn` mutated participating state at all) — pushes ONE
   *  entry under `label` holding that pre-batch snapshot. A batch whose
   *  `fn` mutates nothing (e.g. an import that fails outright) pushes NO
   *  entry, exactly matching what an unbatched call site would have done.
   *
   *  Reentrant: calling this from inside an already-running batch just runs
   *  `fn` — the outer batch owns the one entry; nesting never creates a
   *  second undo step. */
  withHistoryBatch: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
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
type SliceGet = () => AppState;

export function createHistorySlice(set: SliceSet, get: SliceGet): HistorySlice {
  // Set by `recordHistory` whenever it's called while suppressed — tells
  // the (non-reentrant, so never more than one at a time) active batch
  // whether ANYTHING inside it actually would have recorded. A module-level
  // closure variable rather than a store field: it's read/written only by
  // this one synchronous handshake between recordHistory and
  // withHistoryBatch, never by a component, so it doesn't need to be
  // reactive state (and doesn't need a HISTORY_EXCLUDED entry of its own).
  let batchHadRecord = false;

  return {
    history: [],
    future: [],
    viewHistory: [],
    viewFuture: [],
    historySuppressed: false,
    recordHistory: (label) => {
      if (get().historySuppressed) {
        batchHadRecord = true;
        return;
      }
      set((s) => ({
        history: [...s.history, { label, snapshot: snapshotOf(s) }].slice(-HISTORY_DEPTH),
        future: [],
      }));
    },
    withHistoryBatch: async (label, fn) => {
      if (get().historySuppressed) return fn(); // reentrant — outer batch owns the one entry
      const preSnapshot = snapshotOf(get());
      batchHadRecord = false;
      set({ historySuppressed: true });
      try {
        return await fn();
      } finally {
        const had = batchHadRecord;
        batchHadRecord = false;
        set((s) => ({
          historySuppressed: false,
          ...(had
            ? { history: [...s.history, { label, snapshot: preSnapshot }].slice(-HISTORY_DEPTH), future: [] }
            : {}),
        }));
      }
    },
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
