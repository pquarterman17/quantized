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
//    NEVER throws — its failure paths (a write-time cycle rejection, an API
//    error) are caught INSIDE it and
//    surfaced as a `false` return + `setStatus`, never a rejected promise
//    (see store/corrections.ts). A bare `try/await/catch` around that call
//    can therefore never see the failure: it would clear `id` from
//    `staleDatasets` unconditionally after every await, regardless of
//    whether the correction actually re-derived the data — a refused/failed
//    recalc would silently go "clean" while the dataset kept serving its
//    stale value as if it were current. Check the boolean instead; only a
//    genuine success clears the stale mark.
//
//    REVIEW ROUND correction: this list used to include "a deleted background
//    reference", and that was WRONG — a dangling `bgRef` does not return
//    `false` at all. `resolveDataset` yields undefined, so the correction
//    re-runs WITHOUT the background subtraction, `bgRef` is written back as
//    undefined, and it returns `true` (`store/corrections.ts:149-151,189`).
//    That is a real hidden correction, and the boolean check here cannot see
//    it — it is fixed at its own layer, in `applyCorrections`, which now says
//    so via `setStatus`. Cite only what a mechanism actually covers.

import { recomputeDerivedSheet } from "./derivedWorksheets";
import { rowsChangedGuard } from "./corrections";
import { plural } from "../lib/plural";
import { sortForRecalc } from "../lib/recalc";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

const message = (e: unknown): string => (e instanceof Error ? e.message : "error");

/** The dataset `d` depends on, directly, that failed to re-derive this pass
 *  (null when none did). Only the direct edges are checked because
 *  `sortForRecalc` guarantees an upstream-first walk: a failure two hops up
 *  has already propagated into `failed` via the intermediate node by the
 *  time we reach `d`. */
function failedUpstream(
  d: { bgRef?: { datasetId: string }; derivedFrom?: { datasetId: string } },
  failed: ReadonlyMap<string, string>,
): string | null {
  if (d.bgRef != null && failed.has(d.bgRef.datasetId)) return d.bgRef.datasetId;
  if (d.derivedFrom != null && failed.has(d.derivedFrom.datasetId)) return d.derivedFrom.datasetId;
  return null;
}

/** Re-derive every stale dataset (bgRef corrections + derived-worksheet
 *  pipelines), clearing each from `staleDatasets` only on a genuine success.
 *  Called ONLY from useApp.ts's `recalcNow`, BEFORE `recomputeStaleFits` —
 *  corrections change the data fits consume, so datasets settle first.
 *  A pass with any failure ends with ONE status naming how many settled and
 *  which datasets did not, and why (store/reimportAllRun.ts's summary shape)
 *  — the per-dataset messages a walk emits overwrite each other, so a pass
 *  that re-derived two and refused one used to read like it refused all. */
export async function recomputeStaleDatasets(set: SliceSet, get: SliceGet): Promise<void> {
  // Ids that FAILED to re-derive in this pass, with why. Anything downstream
  // of one is left stale too — see `failedUpstream` below.
  const failed = new Map<string, string>();
  const nameOf = (id: string): string => get().datasets.find((x) => x.id === id)?.name ?? id;
  const order = sortForRecalc(get().datasets, get().staleDatasets);
  for (const id of order) {
    const d = get().datasets.find((x) => x.id === id);
    // REVIEW ROUND: clearing only the FAILING id was not enough — the same bug
    // this function exists to fix simply moved one hop downstream. With a->b->c,
    // if b fails, b correctly stays stale, but c was still recomputed from b's
    // now-stale `.data` and then marked clean: no stale dot, holding numbers
    // derived from data that no longer exists. Because `sortForRecalc` walks
    // upstream-first, every upstream of `id` has already been attempted by the
    // time we get here, so one membership test is enough — no second pass.
    const source = d ? failedUpstream(d, failed) : null;
    if (source) {
      failed.set(id, `its source ${nameOf(source)} failed`);
      continue; // stays stale, and so does anything downstream of IT
    }
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
        failed.set(id, `derived worksheet recompute failed: ${message(e)}`); /* stays stale, and so does anything downstream */
      }
    } else if (d?.corrections && d.raw) {
      // REVIEW ROUND: the per-item try/catch was dropped when this moved out of
      // useApp.ts. `applyCorrections` does not throw TODAY, but its own
      // `refuseDerived` guard sits outside its internal try, so a future throw
      // would abort the whole remaining loop, skip `recomputeStaleFits`
      // entirely, and surface as an unhandled rejection from auto mode's
      // `void recalcNow()`. One dataset failing must not silently cancel
      // everyone else's recalculation.
      // `applyCorrections` explains its own refusal through `setStatus`; that
      // text is the reason the summary carries (never a status it did NOT set).
      const before = get().status;
      try {
        if (await get().applyCorrections(id, d.corrections, d.bgRef)) {
          set((s) => ({ staleDatasets: s.staleDatasets.filter((x) => x !== id) }));
          continue;
        }
        failed.set(id, get().status === before ? "correction refused" : get().status); /* stays stale */
      } catch (e) {
        failed.set(id, `recalculation failed: ${message(e)}`);
      }
    } else {
      set((s) => ({ staleDatasets: s.staleDatasets.filter((x) => x !== id) }));
    }
  }
  if (failed.size > 0) {
    const n = order.length;
    const why = [...failed].map(([id, reason]) => `${nameOf(id)}: ${reason}`).join("; ");
    get().setStatus(`recalculated ${n - failed.size} of ${n} dataset${plural(n)} — ${why}`);
  }
}
