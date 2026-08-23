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

/** R6 (POST_SPRINT_INDEPENDENT_REVIEW.md): the opaque handle `withHistoryBatch`
 *  hands to its `fn`, and the ONLY thing that lets a `recordHistory` call fold
 *  into the batch's single undo entry instead of pushing its own. Identity
 *  (not a boolean) is what makes this operation-scoped rather than a global
 *  suppress: an unrelated caller that never received this exact token — every
 *  ordinary `recordHistory(label)` call site in the app, none of which know
 *  batches exist — always records its OWN entry with the CURRENT live state,
 *  regardless of whether some other batch happens to be suppressed at that
 *  instant. Only a call that was explicitly handed the active batch's token
 *  (today: `importPaths`'s `historyToken` param, threaded down to
 *  `addDataset`) can be absorbed. See `withHistoryBatch`'s own doc for why a
 *  plain "is a batch running" boolean cannot make this distinction: the
 *  batch's `fn` genuinely yields the JS thread during its own internal
 *  awaits (a fetch, a probe), and unrelated UI-triggered mutations can only
 *  ever land in exactly those gaps — a boolean keyed off "batch in flight"
 *  cannot tell the batch's own post-await continuation apart from a totally
 *  unrelated event handler that happened to fire during the same gap; only
 *  an explicitly-threaded identity can. */
export type HistoryBatchToken = symbol;

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
  /** True while a `withHistoryBatch` batch is running. Despite the name,
   *  this does NOT make `recordHistory` a no-op for unrelated callers any
   *  more (R6 fix, POST_SPRINT_INDEPENDENT_REVIEW.md) — see
   *  `HistoryBatchToken`'s doc for why a plain boolean can't gate that
   *  safely. It still gates the batch's OWN token-bearing calls, and
   *  remains available for UI that wants to show "an operation is in
   *  progress" (no consumer does today). Session-only control state, not
   *  user data — HISTORY_EXCLUDED, same class as `history`/`future`
   *  themselves. Never set directly outside this module. */
  historySuppressed: boolean;
  /** Push the CURRENT state onto the undo stack under `label` and clear
   *  redo (any newly-recorded action invalidates whatever was undone).
   *  Call this at the very top of a participating mutation, BEFORE its own
   *  `set()`, so the pushed snapshot is the PRE-mutation state.
   *
   *  `batchToken`: pass the token an enclosing `withHistoryBatch` handed
   *  your `fn` to fold this call into that batch's single entry instead of
   *  pushing its own — ONLY for a mutation that is genuinely part of that
   *  operation (e.g. `addDataset` forwarding the token it was given). Omit
   *  it (the overwhelming majority of call sites) for an ordinary
   *  independent edit: it then ALWAYS pushes its own entry with the
   *  current live state, even while some unrelated batch is in flight —
   *  that is what stops an unrelated edit from being silently absorbed
   *  into someone else's asynchronous undo transaction (R6). A token that
   *  doesn't match the CURRENTLY active batch (stale, or no batch running
   *  at all) is treated exactly like no token — recorded on its own. */
  recordHistory: (label: string, batchToken?: HistoryBatchToken) => void;
  /** Run `fn` as ONE undo step, no matter how many `recordHistory` calls
   *  `fn` makes THROUGH THE TOKEN it's handed (store/relink.ts's
   *  `commit()` hand-rolled this exact shape for its own batch before this
   *  existed — see that module's doc; this generalizes it). Snapshots the
   *  PRE-batch state up front, mints a fresh `HistoryBatchToken`, and calls
   *  `fn(token)` — `fn` must thread that token down to every mutation IT
   *  OWNS (e.g. `importPaths(paths, token)`) for them to fold together;
   *  only if at least one folded call actually fired (i.e. the operation
   *  mutated participating state at all) does this push ONE entry under
   *  `label` holding the pre-batch snapshot when `fn` settles. A batch that
   *  mutates nothing (e.g. an import that fails outright) pushes NO entry,
   *  exactly matching what an unbatched call site would have done.
   *
   *  Operation-scoped, NOT a global suppress (R6,
   *  POST_SPRINT_INDEPENDENT_REVIEW.md): an ordinary `recordHistory(label)`
   *  call with no token — every pre-existing call site in the app — is
   *  UNAFFECTED by a batch being in flight and still records its own
   *  independent entry, undo/redo-able on its own, even if it happens to
   *  land during one of `fn`'s internal awaits. Only a call explicitly
   *  handed THIS token can be absorbed.
   *
   *  Reentrant: calling this from inside an already-running batch just runs
   *  `fn` under the OUTER batch's token — the outer batch owns the one
   *  entry; nesting never creates a second undo step. */
  withHistoryBatch: <T>(label: string, fn: (token: HistoryBatchToken) => Promise<T>) => Promise<T>;
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
  // Set by `recordHistory` whenever a call carrying the ACTIVE batch's own
  // token folds in — tells the (non-reentrant, so never more than one at a
  // time) active batch whether ANYTHING it owns actually would have
  // recorded. A module-level closure variable rather than a store field:
  // it's read/written only by this one synchronous handshake between
  // recordHistory and withHistoryBatch, never by a component, so it
  // doesn't need to be reactive state (and doesn't need a
  // HISTORY_EXCLUDED entry of its own).
  let batchHadRecord = false;
  // The currently-running batch's identity (R6 fix) — `null` when no batch
  // is in flight. `recordHistory` folds a call in ONLY when its own
  // `batchToken` argument matches this exactly; anything else (no token,
  // or a token from a batch that has already finished) records on its own.
  // Same closure-only reasoning as `batchHadRecord` above.
  let activeBatchToken: HistoryBatchToken | null = null;
  // The batch's own "before" snapshot — captured LAZILY, on the FIRST call
  // that actually folds into the batch, using the LIVE state at that
  // instant (exactly like an ordinary unsuppressed `recordHistory` would).
  // NOT captured eagerly when `withHistoryBatch` is first called: an
  // unrelated edit can land — and now correctly gets its own entry — in the
  // gap BEFORE the operation's own first mutation (its `await`s haven't
  // produced anything to fold yet). An eager snapshot taken before that
  // edit happened would still be wrong: undoing the batch's OWN entry would
  // restore all the way back to before that unrelated edit too, silently
  // reverting it a second time even though it now has its own separate undo
  // entry. Capturing lazily at the first fold means the batch's "before"
  // already includes anything that happened up to that point, foreign or
  // not — undoing the batch then only ever unwinds ITS OWN mutations.
  //
  // KNOWN LIMITATION (honest, not fixed — out of R6's actual reachable
  // scope): this only covers a gap BEFORE the operation's first fold. If a
  // future multi-step batch folds more than one call with a real `await`
  // BETWEEN them (today's one caller, `importPaths` invoked with a single
  // path, makes all of its folded `addDataset` calls synchronously back to
  // back after its one `await`, so this never arises for it), an unrelated
  // edit landing in THAT LATER gap would still be reverted by undoing the
  // batch's single entry, because the snapshot model here restores an
  // absolute prior state rather than an inverse patch of the operation's
  // own diff. Revisit if a caller ever needs multiple awaited folds.
  let batchPreSnapshot: HistorySnapshot | null = null;

  return {
    history: [],
    future: [],
    viewHistory: [],
    viewFuture: [],
    historySuppressed: false,
    recordHistory: (label, batchToken) => {
      if (get().historySuppressed && batchToken !== undefined && batchToken === activeBatchToken) {
        if (batchPreSnapshot === null) batchPreSnapshot = snapshotOf(get());
        batchHadRecord = true;
        return;
      }
      // Either no batch is running, or this call doesn't carry (a match
      // for) the currently active one's token — an ordinary, independent
      // edit. Record it on its own, against the CURRENT live state, even
      // while some other batch is suppressed: this is what stops that
      // batch from silently absorbing it (R6).
      set((s) => ({
        history: [...s.history, { label, snapshot: snapshotOf(s) }].slice(-HISTORY_DEPTH),
        future: [],
      }));
    },
    withHistoryBatch: async (label, fn) => {
      // Reentrant: run under the OUTER batch's own token so a nested call's
      // own folded recordHistory calls still land in the one entry the
      // outer batch owns, rather than starting a second, unrelated token.
      if (get().historySuppressed && activeBatchToken !== null) return fn(activeBatchToken);
      const token: HistoryBatchToken = Symbol(label);
      batchHadRecord = false;
      batchPreSnapshot = null;
      activeBatchToken = token;
      set({ historySuppressed: true });
      try {
        return await fn(token);
      } finally {
        const had = batchHadRecord;
        const preSnapshot = batchPreSnapshot;
        batchHadRecord = false;
        batchPreSnapshot = null;
        activeBatchToken = null;
        set((s) => ({
          historySuppressed: false,
          // `preSnapshot` is non-null whenever `had` is true — the same
          // fold that set `batchHadRecord` also captured it (see
          // `recordHistory` above) — but TypeScript can't see that
          // correlation across the two closures, so the null check reads
          // as a second guard rather than a real possibility.
          ...(had && preSnapshot
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
