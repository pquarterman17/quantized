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
// TRAP a user who is looking at exclusions they want gone (a dataset can hold
// row state and later be marked pending again by a reimport), so the guard
// would create the lockout it exists to prevent. Pinned by a test.
//
// This slice does NOT solve BUG-009's other half — refuse-vs-resolve-then-apply
// is a store-wide product decision (see store/pendingEdit.ts's "KNOWN
// INCOMPLETE, DELIBERATELY" note) and is not attempted here.

import { isActive } from "../lib/datafilter";
import { keepOnlyExcluded, mergeExcluded, sanitizeExcluded, toggleExcluded } from "../lib/rowstate";
import type { DataFilter } from "../lib/types";
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

/** BUG-009: true when `id`'s full data has not arrived, so the caller must
 *  abort. Wraps the one shared guard (`store/pendingEdit.ts`) with this
 *  slice's id-to-dataset lookup, so each action below is a single line and no
 *  action can accidentally carry its own copy of the rule — the "four wrong
 *  copies" history that module's header records. A dataset id that no longer
 *  resolves is not pending; the action's own `datasets.map` then simply
 *  matches nothing. */
function pendingBlocks(get: () => AppState, id: string, action: string): boolean {
  const ds = get().datasets.find((d) => d.id === id);
  return ds != null && refusePendingEdit(get, ds, action);
}

export function createRowStateSlice(
  set: (fn: (s: AppState) => Partial<AppState>) => void,
  get: () => AppState,
): RowStateSlice {
  return {
    selection: null,

    toggleRowExcluded: (id, row) => {
      if (pendingBlocks(get, id, "excluding rows")) return;
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
      if (pendingBlocks(get, id, "excluding rows")) return;
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
      if (pendingBlocks(get, sel.datasetId, "excluding rows")) return;
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
      if (pendingBlocks(get, sel.datasetId, "excluding rows")) return;
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
      if (pendingBlocks(get, id, "filtering")) return;
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const active = filter.filter(isActive);
          return { ...d, filter: active.length ? active : undefined };
        }),
      }));
    },

    // NOT pending-guarded, deliberately — see the module header.
    clearDatasetFilter: (id) =>
      set((s) => ({
        datasets: s.datasets.map((d) => (d.id === id ? { ...d, filter: undefined } : d)),
      })),
  };
}
