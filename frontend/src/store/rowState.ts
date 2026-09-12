// Row state — per-row EXCLUSION (#50), the transient row SELECTION that feeds
// it, and the per-column data FILTER (#53). Extracted out of useApp.ts under
// the store-size ratchet (architecture.test.ts's STORE_PINS), the same
// self-contained-feature-out pattern as store/datasetMeta.ts and
// store/dataIntake.ts: one import line, one word on AppState's extends clause,
// one creator-spread line. `datasets` and `selection` stay plain fields on the
// composed AppState — this slice owns `selection` and mutates the shared
// `datasets` through set/get like every other slice.
//
// The extraction is what FUNDS the pending guard below: useApp.ts sat 2 lines
// under its pin, and the repo's rule is to extract a cohesive sibling rather
// than shave comments to fit a ceiling.
//
// BUG-009 (plans/BUGS_AND_ISSUES.md): every action here that WRITES a row
// preference now goes through `refusePendingEdit` first. A pending dataset's
// `.data` is a decimated display projection, so a row INDEX taken against it
// does not mean the same row once the real book lands — which is exactly why
// `lib/bookData.ts`'s `installBookData` clears `excludedRows` and `filter`
// outright when the fetch resolves (a deliberate earlier fix, #50/#53). Before
// this guard the two halves combined into silent LOSS: the user excluded rows
// or built a filter on a preview, the fetch landed, and their work vanished
// with no message and no undo entry to notice. Refusing up front, with the
// "still loading its full data" status every other pending-guarded action
// uses, says so instead.
//
// WHAT IS DELIBERATELY *NOT* GUARDED: `clearRowExclusions` and
// `clearDatasetFilter`. Clearing cannot lose user intent — it destroys a
// preference rather than recording one, and it is precisely what
// `installBookData` itself does a moment later. Refusing a clear would instead
// TRAP a user looking at exclusions they want gone, so the guard would create
// the lockout it exists to prevent. Pinned by a test in BOTH directions.
//
// HOW row state and `pending` come to coexist — corrected in review, because
// the first version of this note named the wrong path. It is NOT a reimport:
// `store/reimport.ts` sets `pending: undefined` in the same updater it writes,
// which is exactly why that file sits in `PENDING_EDIT_EXEMPT`. `pending` is
// only ever SET on a brand-new dataset (`store/importDatasets.ts`). The
// reachable path is the `.dwk` ROUND TRIP: `lib/workspaceSerialize.ts` writes
// `excludedRows`, `filter` and `pending` independently, and
// `lib/workspaceDatasetParse.ts` restores all three independently, on both open
// and Append-workspace. So a document saved by a pre-guard build — or a
// hand-edited one — loads pending WITH row state, and the unguarded clear is
// what lets the user get rid of it.
//
// This slice does NOT solve BUG-009's other half — refuse-vs-resolve-then-apply
// is a store-wide product decision (see store/pendingEdit.ts's "KNOWN
// INCOMPLETE, DELIBERATELY" note) and is not attempted here.

import { isActive } from "../lib/datafilter";
import { keepOnlyExcluded, mergeExcluded, sanitizeExcluded, toggleExcluded } from "../lib/rowstate";
import type { ColumnFilter, DataFilter, Dataset } from "../lib/types";
import { refusePendingEdit } from "./pendingEdit";
import type { AppState } from "./useApp";

export interface RowStateSlice {
  // Row state (#50): persistent per-row exclusion on a dataset. Excluded rows
  // stay visible but drop from analysis everywhere; round-trips .dwk.
  toggleRowExcluded: (id: string, row: number) => void;
  setRowsExcluded: (id: string, rows: number[]) => void;
  clearRowExclusions: (id: string) => void;
  // Row selection (#50 selection dimension): a transient brush on the active
  // dataset. `selection` is null or {datasetId, rows}; it is "live" only when its
  // datasetId matches activeId, so switching datasets naturally drops it (no
  // reset wiring). This is the Stage "Worksheet" tab's channel only — an MDI
  // document window uses its own independent one (`worksheetSelections`,
  // GUI_INTERACTION #14, store/worksheetSelection.ts). The bulk actions turn a
  // selection into persistent exclusions; their optional `windowId` targets
  // that per-window map instead (omit it for the Stage tab's own selection).
  selection: { datasetId: string; rows: number[] } | null;
  toggleRowSelected: (row: number) => void;
  setRowSelection: (rows: number[]) => void;
  clearRowSelection: () => void;
  excludeSelectedRows: (windowId?: string) => void;
  keepOnlySelectedRows: (windowId?: string) => void;
  // Local data filter (#53): non-destructive per-column predicates that narrow
  // the analysis view of a dataset. Only active predicates are stored.
  setDatasetFilter: (id: string, filter: DataFilter) => void;
  clearDatasetFilter: (id: string) => void;
}

// #14: the live selection for excludeSelectedRows/keepOnlySelectedRows — a
// document window's own map entry, or the legacy active-dataset singleton
// for the Stage tab (`windowId` omitted); same stale-datasetId guard either way.
function worksheetOrActiveSelection(
  s: AppState,
  windowId: string | undefined,
): { datasetId: string; rows: number[] } | null {
  if (windowId) return s.worksheetSelections[windowId] ?? null;
  const id = s.activeId;
  return id != null && s.selection?.datasetId === id ? s.selection : null;
}

/** The dataset `id` names, or null. A lookup ONLY: each action below calls
 *  `refusePendingEdit` itself rather than going through a wrapper.
 *
 *  That is deliberate, and sabotage is what found it. `architecture.test.ts`'s
 *  pending-edit ratchet detects a guard by walking back from the offending
 *  updater for the literal `refusePendingEdit` inside the SAME action — a
 *  wrapper hid the call, so every writer in this file was reported unguarded
 *  even though all five were guarded. Naming the real function at each site is
 *  what lets the ratchet VERIFY the guard rather than take its word, and it
 *  matches `store/pendingEdit.ts`'s header: one rule, one home, called
 *  directly, never re-expressed. A null lookup ABORTS rather than falling
 *  through, so a stale id cannot leave a dead undo entry behind. */
function datasetOf(get: () => AppState, id: string): Dataset | null {
  return get().datasets.find((d) => d.id === id) ?? null;
}

/** Are these two filters the same CONSTRAINT? Compared field by field rather
 *  than by JSON, so key order cannot make two identical filters look different,
 *  and an absent filter reads equal to an empty one (both mean "no
 *  constraint" — `setDatasetFilter` stores `undefined` for an empty list). */
function sameFilter(a: DataFilter | undefined, b: readonly ColumnFilter[]): boolean {
  const left = a ?? [];
  if (left.length !== b.length) return false;
  return left.every((p, i) => {
    const q = b[i];
    return (
      p.col === q.col &&
      p.kind === q.kind &&
      p.min === q.min &&
      p.max === q.max &&
      (p.values?.length ?? -1) === (q.values?.length ?? -1) &&
      (p.values ?? []).every((v, k) => v === (q.values ?? [])[k])
    );
  });
}

export function createRowStateSlice(
  set: (fn: (s: AppState) => Partial<AppState>) => void,
  get: () => AppState,
): RowStateSlice {
  return {
    selection: null,

    toggleRowExcluded: (id, row) => {
      const ds = datasetOf(get, id);
      if (!ds || refusePendingEdit(get, ds, "excluding rows")) return;
      get().recordHistory("row exclusion");
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const next = toggleExcluded(d.excludedRows, row);
          return { ...d, excludedRows: next.length ? next : undefined };
        }),
      }));
    },

    setRowsExcluded: (id, rows) => {
      const ds = datasetOf(get, id);
      if (!ds || refusePendingEdit(get, ds, "excluding rows")) return;
      get().recordHistory("row exclusion");
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          // Note this clamp is against the PREVIEW row count on a pending
          // dataset — another reason the guard above has to come first.
          const clean = sanitizeExcluded(rows, d.data.time.length);
          return { ...d, excludedRows: clean.length ? clean : undefined };
        }),
      }));
    },

    // NOT pending-guarded, deliberately — see the module header.
    clearRowExclusions: (id) => {
      get().recordHistory("clear row exclusions");
      set((s) => ({
        datasets: s.datasets.map((d) => (d.id === id ? { ...d, excludedRows: undefined } : d)),
      }));
    },

    toggleRowSelected: (row) => {
      const id = get().activeId;
      if (id == null) return;
      set((s) => {
        const cur = s.selection?.datasetId === id ? s.selection.rows : [];
        const rows = cur.includes(row)
          ? cur.filter((r) => r !== row)
          : [...cur, row].sort((a, b) => a - b);
        return { selection: rows.length ? { datasetId: id, rows } : null };
      });
    },

    setRowSelection: (rows) => {
      const id = get().activeId;
      if (id == null) return;
      const clean = [...new Set(rows)].sort((a, b) => a - b);
      set(() => ({ selection: clean.length ? { datasetId: id, rows: clean } : null }));
    },

    clearRowSelection: () => set(() => ({ selection: null })),

    excludeSelectedRows: (windowId) => {
      const sel = worksheetOrActiveSelection(get(), windowId);
      if (!sel?.rows.length) return;
      const ds = datasetOf(get, sel.datasetId);
      if (!ds || refusePendingEdit(get, ds, "excluding rows")) return;
      get().recordHistory("row exclusion");
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === sel.datasetId ? { ...d, excludedRows: mergeExcluded(d.excludedRows, sel.rows) } : d,
        ),
      }));
      if (windowId) get().clearWorksheetRowSelection(windowId);
      else set(() => ({ selection: null }));
    },

    keepOnlySelectedRows: (windowId) => {
      const sel = worksheetOrActiveSelection(get(), windowId);
      if (!sel?.rows.length) return;
      const ds = datasetOf(get, sel.datasetId);
      if (!ds || refusePendingEdit(get, ds, "excluding rows")) return;
      get().recordHistory("row exclusion");
      set((s) => ({
        datasets: s.datasets.map((d) =>
          // `keepOnlyExcluded` takes the COMPLEMENT over `time.length`, so on a
          // pending dataset it would build that complement over the preview's
          // row count — the guard above is what keeps that from happening.
          d.id === sel.datasetId ? { ...d, excludedRows: keepOnlyExcluded(sel.rows, d.data.time.length) } : d,
        ),
      }));
      if (windowId) get().clearWorksheetRowSelection(windowId);
      else set(() => ({ selection: null }));
    },

    setDatasetFilter: (id, filter) => {
      const ds = datasetOf(get, id);
      if (!ds || refusePendingEdit(get, ds, "filtering")) return;
      // Group S: the filter is part of the dataset's ANALYSIS VIEW exactly as
      // `excludedRows` is, and every exclusion path above records history.
      // This one did not, which cost more than a missing "Undo data filter":
      // `filter` LIVES ON the dataset, so it is inside every snapshot, and
      // skipping the record also skipped the `future: []` that every edit owes
      // redo. So an undo of some LATER unrelated action silently reverted the
      // filter too, and a redo across a filter edit destroyed it.
      //
      // COALESCED, not plain: both controls that reach here fire per `input`
      // event (see `recordHistoryCoalesced`), so one entry per editing run.
      // Keyed per dataset — filtering A then B must stay two undo steps.
      const next = filter.filter(isActive);
      // Review round: a filter edit that changes NOTHING must record nothing.
      // It is reachable — `DataFilterPanel`'s NumberField commits `undefined`
      // when you type a bound and erase it (`parseBound("")`), and toggling a
      // level off and back on lands on the same predicate set. The
      // unconditional record pushed a phantom entry whose snapshot equals the
      // present AND wiped `future`, inverting this group's own second bug into
      // "a filter NON-change invalidates redo".
      if (sameFilter(ds.filter, next)) return;
      get().recordHistoryCoalesced("data filter", `filter:${id}`);
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id ? { ...d, filter: next.length ? next : undefined } : d,
        ),
      }));
    },

    // NOT pending-guarded, deliberately — see the module header.
    clearDatasetFilter: (id) => {
      // Nothing to clear is not an edit: recording here would push an undo
      // entry for a no-op, and (worse) break a preceding "data filter" run's
      // coalescing so the next slider nudge started a second entry.
      const ds = datasetOf(get, id);
      if (!ds?.filter) return;
      // Its OWN label, and deliberately NOT coalesced: clearing is a discrete
      // gesture with a discrete intent, and it must not fold into the editing
      // run that preceded it — undoing a clear should give the filter back, not
      // rewind to before the filter existed.
      get().recordHistory("clear data filter");
      set((s) => ({
        datasets: s.datasets.map((d) => (d.id === id ? { ...d, filter: undefined } : d)),
      }));
    },
  };
}
