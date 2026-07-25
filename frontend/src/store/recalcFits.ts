// Fit recomputation for the recalc graph (MAIN_PLAN #1 / #30).
//
// Split out of useApp.ts's `recalcNow` under the store-size ratchet, and the
// split is cohesive rather than merely convenient: this is the ONE place a
// saved fit recipe is replayed, so #30's "was this result recomputed or is it
// the original?" stamping belongs beside it.
//
// The recipe is authoritative: `fitDataForSpec` reproduces the CHANNELS the fit
// recorded, falling back to the live plotted selection only for legacy specs
// that predate the recipe — never to time/values[0], which is the bug the audit
// found in the first place.

import { fitModel } from "../lib/api";
import { fitDataForSpec, stampRecompute } from "../lib/fitselection";
import { activeRowIndices, droppedRows, expandToFull } from "../lib/rowstate";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Re-run every stale fit, clearing each from `staleFits` as it settles. */
export async function recomputeStaleFits(set: SliceSet, get: SliceGet): Promise<void> {
  for (const id of [...get().staleFits]) {
    const d = get().datasets.find((x) => x.id === id);
    if (!d?.fitSpec) {
      set((s) => ({ staleFits: s.staleFits.filter((x) => x !== id) }));
      continue;
    }
    try {
      // Reproduce the fit's RECORDED channels (audit P1 #3), falling back
      // to the live plotted selection for legacy specs — not time/values[0].
      const sel = fitDataForSpec(d, d.fitSpec, get().xKey, get().yKeys, get().seriesOrder);
      if (!sel || sel.x.length === 0) throw new Error("no data");
      const r = await fitModel({ model: d.fitSpec.model, x: sel.x, y: sel.y, dy: sel.dy });
      const yFit = r.yFit as (number | null)[] | undefined;
      // Refresh the overlay only if this dataset's fit is the one shown.
      if (Array.isArray(yFit) && get().fitOverlay?.datasetId === id) {
        const n = d.data.time.length;
        const kept = activeRowIndices(n, droppedRows(d));
        const y = kept.length === n ? yFit : expandToFull(yFit, kept, n);
        set({ fitOverlay: { datasetId: id, y } });
      }
      // #30: stamp the re-run so the workspace distinguishes a HISTORICAL
      // result from one the recalc graph regenerated over changed data.
      set((s) => ({
        staleFits: s.staleFits.filter((x) => x !== id),
        datasets: s.datasets.map((d2) =>
          d2.id === id && d2.fitSpec ? { ...d2, fitSpec: stampRecompute(d2.fitSpec, r) } : d2,
        ),
      }));
    } catch (e) {
      get().setStatus(
        `recalc fit failed: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }
}
