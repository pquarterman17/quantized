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
// Also the DATA FILTER, set and cleared (Group S). This list omitted it for as
// long as the filter existed, which is how the omission in `store/rowState.ts`
// went unnoticed — the doc that should have caught it had the same gap. The
// filter is the one participant that records through
// `recordHistoryCoalesced` rather than `recordHistory`, because its controls
// fire on every `input` event; see that action for the whole argument.
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

import type { AppState } from "./useApp";
import { restorePatch, snapshotOf, type HistorySnapshot } from "./historySnapshot";

/** Bounded stack depth — oldest entries evicted first (both directions, for
 *  symmetry; redo can never exceed how many entries were ever undone from a
 *  present history, so this is a defensive cap, not a load-bearing one). */
const HISTORY_DEPTH = 50;

export interface HistoryEntry {
  /** Shown by the Edit menu / ⌘K as "Undo <label>" / "Redo <label>". */
  label: string;
  snapshot: HistorySnapshot;
  /** Set only by `recordHistoryCoalesced` (Group S). Two CONSECUTIVE edits
   *  carrying the same key collapse into the first one's entry, so a
   *  continuously-firing control records once per editing run instead of once
   *  per event. Absent on every ordinary `recordHistory` entry, which is what
   *  makes an unrelated edit landing in between break the run. */
  coalesceKey?: string;
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
  /** One undo entry per continuous EDITING RUN, for a control that fires on
   *  every event rather than once per gesture (Group S).
   *
   *  WHY THIS EXISTS. `setDatasetFilter` is driven by a dual-thumb
   *  `<input type="range">` and a `NumberField`, both of which call it on every
   *  `input` event — a single drag or a typed "12.5" is four-plus store writes.
   *  A plain `recordHistory` there pushes an entry per event, and at
   *  HISTORY_DEPTH 50 that silently evicts everything else the user had done:
   *  a worse bug than the missing entry it set out to fix.
   *
   *  WHY NOT `withHistoryBatch`. That folds calls that are handed its token
   *  inside one `await`ed function. A pointer drag is not a function — it spans
   *  events with no promise to hold open — so the batch would have to be kept
   *  alive by a listener, and every mutation threaded the token. Coalescing
   *  needs neither.
   *
   *  WHY NOT record at gesture START instead (the other obvious design): it
   *  works, but only for the slider, and only if the panel grows pointerdown
   *  AND keydown handlers (native range inputs are arrow/Home/End operable) —
   *  and it does nothing for the typed field. Coalescing covers every entry
   *  point at once, in the store, where the invariant belongs.
   *
   *  The kept entry is the FIRST of the run, so its snapshot is the state
   *  before the run began — which is what undo must restore. Later calls in the
   *  run still clear `future`, because a redo across an edit is exactly the
   *  thing that would destroy it.
   *
   *  `key` must name the thing being edited (e.g. `filter:<datasetId>`), not
   *  just the kind: filtering dataset A and then dataset B are two edits, and a
   *  shared key would collapse them into one. */
  recordHistoryCoalesced: (label: string, key: string) => void;
  /** Close any open coalescing run, so the NEXT `recordHistoryCoalesced` call
   *  starts a fresh undo entry instead of folding into the last one.
   *
   *  Review round. Coalescing on its own has no notion of when a gesture ENDS —
   *  the first design's only boundary was "somebody else recorded history", so a
   *  drag now and a drag an hour later folded together and one Ctrl+Z threw both
   *  away. That is the very failure Group S set out to remove, arriving from the
   *  other side. Callers say where a gesture begins or ends (a pointerdown, a
   *  blur, a discrete click); this is that signal. Cheap and idempotent, so
   *  calling it when no run is open is fine. */
  endHistoryRun: () => void;
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

/** The same entry with its coalescing run closed, so nothing folds into it
 *  again. Shared by `endHistoryRun` and `undo` — both have to do this, and two
 *  copies of a destructuring rest-strip is one copy too many. */
function closeRun(e: HistoryEntry): HistoryEntry {
  const { coalesceKey: _closed, ...bare } = e;
  return bare;
}

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
  // KNOWN LIMITATION (honest, corrected by the R6 code-review round — the
  // ORIGINAL wording here was false, not merely hypothetical): this only
  // covers a gap BEFORE the operation's first fold. ANY real `await` that
  // still runs AFTER the last fold — not just one squeezed BETWEEN two
  // folds — reopens the same hole, because this is a snapshot-restore
  // design (an absolute prior state), never an inverse patch of the
  // operation's own diff: an unrelated edit landing in that later gap gets
  // its own entry (correct), but undoing the batch's single entry still
  // reverts it too (wrong). Today's one caller (`importChangedAsNewVersion`)
  // is safe from this NOT because it only ever makes one fold, but because
  // `importPaths({ presentOutcome: false })` guarantees NOTHING async runs
  // after that fold — `presentBatchOutcome`'s own real awaits (a dynamic
  // import, an async recipe match) are skipped entirely for a batched
  // caller instead of trusted to finish before the batch's `fn` returns
  // (F1, POST_SPRINT_INDEPENDENT_REVIEW.md's R6 code-review round; see
  // `ImportPathsOptions`'s doc, store/importDatasets.ts). Any FUTURE caller
  // of `withHistoryBatch` must keep this same invariant — zero real awaits
  // after its last fold — or this limitation is live again for it.
  let batchPreSnapshot: HistorySnapshot | null = null;

  return {
    history: [],
    future: [],
    viewHistory: [],
    viewFuture: [],
    historySuppressed: false,
    recordHistory: (label, batchToken) => {
      if (get().historySuppressed && batchToken !== undefined && batchToken === activeBatchToken) {
        if (batchPreSnapshot === null) {
          batchPreSnapshot = snapshotOf(get());
          // F3 (R6 code-review): clear redo the moment the batch commits to
          // actually mutating something — the same "any new action
          // invalidates redo" rule every other `recordHistory` call enforces
          // immediately, not deferred until the batch's own entry lands in
          // `withHistoryBatch`'s `finally` (which can be further awaits
          // away). Without this, a Redo pressed mid-batch replayed a stale
          // pre-batch `future` snapshot over already-half-mutated state.
          set({ future: [] });
        }
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
    recordHistoryCoalesced: (label, key) =>
      set((s) => {
        const top = s.history[s.history.length - 1];
        // A batch in flight ends the run rather than folding into it. R6's
        // promise is that an edit which never received the batch's token keeps
        // its OWN entry; letting it fold into a pre-batch snapshot instead
        // would break exactly the isolation that round established.
        const open = !s.historySuppressed && top?.coalesceKey === key;
        // Inside a run: the entry already there holds the pre-run state, so keep
        // it and only invalidate redo.
        if (open) return { future: [] };
        return {
          history: [...s.history, { label, snapshot: snapshotOf(s), coalesceKey: key }].slice(-HISTORY_DEPTH),
          future: [],
        };
      }),
    endHistoryRun: () =>
      set((s) => {
        const top = s.history[s.history.length - 1];
        if (!top?.coalesceKey) return {};
        return { history: [...s.history.slice(0, -1), closeRun(top)] };
      }),
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
        // Popping an entry re-exposes whatever was under it. If THAT entry
        // still carries a `coalesceKey`, a later coalesced edit would fold into
        // a snapshot from before its own run — review round, confirmed by test:
        // filter, exclude a row, undo the exclusion, nudge the filter, and one
        // Ctrl+Z discarded the whole filter rather than the nudge. A run that
        // has been buried is finished, so the key comes off as it surfaces.
        const under = s.history[s.history.length - 2];
        const rest = s.history.slice(0, -1);
        if (under?.coalesceKey) rest[rest.length - 1] = closeRun(under);
        return {
          history: rest,
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

// Re-exported: `HistorySnapshot` is part of this module's public surface (the
// entry type below names it), and moving the type should not move its import
// site for every consumer.
export type { HistorySnapshot } from "./historySnapshot";
