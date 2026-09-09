// Dataset recomputation for the recalc graph (MAIN_PLAN #1 / LIBRARY_WORKBOOK_UX_PLAN
// PR K K5c/K5d) — the "corrections/derived-worksheet" half of `recalcNow`.
//
// Split out of useApp.ts under the store-size ratchet (mirrors
// store/recalcFits.ts's own split, for the same reason): this is the ONE
// place a stale dataset is actually re-derived, so its two invariants live
// beside it rather than inline in the composed store.
//
// 1. ORDER INDEPENDENCE (LIBRARY_WORKBOOK_UX_PLAN "recalculation ...
//    order independence"): `staleDatasets` is an APPEND-order list
//    (lib/recalc.ts's `markStale`), not a topological one — two separate
//    `touchDataset` gestures (e.g. an edit on B directly, then an edit on A
//    upstream of B) can leave a downstream id sitting BEFORE its own
//    upstream in the array. Sort into true dependency order
//    (`sortForRecalc`) before walking it, so a chain always rebuilds
//    upstream-first regardless of which gesture happened to append which id
//    when.
// 2. AUDITABILITY ("never hide ... a stale/failed state"): `applyCorrections`
//    NEVER throws — every failure path (a deleted background reference, a
//    write-time cycle rejection, an API error) is caught INSIDE it and
//    surfaced as a `false` return + `setStatus`, never a rejected promise
//    (see store/corrections.ts). A bare `try/await/catch` around that call
//    can therefore never see the failure: it would clear `id` from
//    `staleDatasets` unconditionally after every await, regardless of
//    whether the correction actually re-derived the data — a refused/failed
//    recalc would silently go "clean" while the dataset kept serving its
//    stale value as if it were current. Check the boolean instead; only a
//    genuine success clears the stale mark.

import { recomputeDerivedSheet } from "./derivedWorksheets";
import { rowsChangedGuard } from "./corrections";
import { sortForRecalc } from "../lib/recalc";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Re-derive every stale dataset (bgRef corrections + derived-worksheet
 *  pipelines), clearing each from `staleDatasets` only on a genuine success.
 *  Called ONLY from useApp.ts's `recalcNow`, BEFORE `recomputeStaleFits` —
 *  corrections change the data fits consume, so datasets settle first. */
export async function recomputeStaleDatasets(set: SliceSet, get: SliceGet): Promise<void> {
  for (const id of sortForRecalc(get().datasets, get().staleDatasets)) {
    const d = get().datasets.find((x) => x.id === id);
    // A derived worksheet (K2) recomputes through its OWN pipeline-against-
    // source executor, never the plain bgRef/corrections path below —
    // checked FIRST since a derived sheet also carries `.corrections`/`.raw`
    // (its pipeline recipe + a cache of the SOURCE's data), which would
    // otherwise match the generic branch and silently re-run against its
    // own stale cache instead of the source's current data.
    if (d?.derivedFrom) {
      try {
        const updated = await recomputeDerivedSheet(get, d);
        // #50/#53 guard (P1-2 review fix): a row-count-changing recompute
        // invalidates excludedRows + the four overlays — the SAME shared
        // helper applyCorrections uses, so the two call sites can't drift.
        const rowsChanged = updated.data.time.length !== d.data.time.length;
        let statusMsg: string | undefined;
        set((s) => {
          const guard = rowsChangedGuard(s, id, rowsChanged, d.excludedRows);
          statusMsg = guard.statusMessage;
          return {
            datasets: s.datasets.map((x) => (x.id === id ? { ...updated, ...guard.datasetPatch } : x)),
            staleDatasets: s.staleDatasets.filter((x) => x !== id),
            ...guard.statePatch,
          };
        });
        if (statusMsg) get().setStatus(statusMsg);
      } catch (e) {
        get().setStatus(`derived worksheet recompute failed: ${e instanceof Error ? e.message : "error"}`);
        /* stays stale */
      }
    } else if (d?.corrections && d.raw) {
      const ok = await get().applyCorrections(id, d.corrections, d.bgRef);
      if (ok) {
        set((s) => ({ staleDatasets: s.staleDatasets.filter((x) => x !== id) }));
      } /* else: stays stale; applyCorrections already surfaced the error via setStatus */
    } else {
      set((s) => ({ staleDatasets: s.staleDatasets.filter((x) => x !== id) }));
    }
  }
}
