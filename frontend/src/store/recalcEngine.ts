// THE RECALC ENGINE (#1; K3/K5c/K5d generalize it over derived worksheets),
// extracted from store/useApp.ts (audit P4.1, the ninth domain — store-size
// ratchet, MAIN_PLAN #2). Composed into the ONE useApp store exactly like
// ./datasetSelection: `useApp` spreads `createRecalcEngineSlice(set, get)`
// into the store, so every `useApp((s) => s.staleFits)` selector and
// `getState().touchDataset(id)` call keeps working. A code boundary, not a
// second store.
//
// WHAT THIS MODULE OWNS: the `recalcMode`/`staleDatasets`/`staleFits` fields
// (declared and initialized HERE, an own-state slice), the scheduler's
// module-level state (debounce timer, in-progress guard, pending follow-up
// flag), and the four actions — `setRecalcMode`, `touchDataset`, `recalcNow`,
// `setFitSpec`. The work a pass does stays where it was: ./recalcDatasets
// (corrections + derived worksheets) and ./recalcFits (saved fits).
//
// Contract: none of the four records an undo step, toasts or records a macro
// step. `touchDataset` only ever ADDS ids to the stale lists, never mutates
// data. The scheduler state is per MODULE, not per call, on purpose: the
// guard is what stops a pass's own writes from re-marking (the loop would
// feed itself), and the pending flag is what turns a mid-pass `recalcNow`
// into a follow-up pass instead of a no-op (#3).
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React. ./useApp
// is TYPE-only, so the runtime graph stays one-directional (useApp -> here).
//
// Characterization tests: store/recalcEngine.characterization.test.ts (the
// exact keys each action writes, the debounce, the re-entrancy contract) —
// written green against the pre-extraction useApp.ts and unchanged by the
// move. store/recalc.test.ts covers what a pass recomputes.

import { downstreamOf, markStale, type RecalcMode } from "../lib/recalc";
import type { FitSpec } from "../lib/types";
import { refreshFitRefsLater } from "./computedColumns";
import { recomputeStaleDatasets } from "./recalcDatasets";
import { recomputeStaleFits } from "./recalcFits";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

// Recalc scheduler internals (#1): a module-level debounce timer plus an
// in-progress guard so the recalc's own applyCorrections calls never re-mark
// or re-schedule (the loop would otherwise feed itself).
let _recalcTimer: ReturnType<typeof setTimeout> | null = null;
let _recalcInProgress = false;
let _recalcPending = false; // #3: request mid-pass -> follow-up pass, not a no-op

export interface RecalcEngineSlice {
  // Recalc engine (#1): auto re-runs downstream corrections/fits when data
  // changes; manual only flips staleness (#4 badges); off does neither.
  recalcMode: RecalcMode;
  // Dirty nodes awaiting recalculation (dataset ids). A dataset is stale when
  // its corrections need re-deriving (its bg source changed); a fit is stale
  // when its dataset's data changed under a saved fitSpec.
  staleDatasets: string[];
  staleFits: string[];
  // Mark everything downstream of a data change, run the dirty set now, and
  // record/clear a dataset's re-runnable fit spec.
  setRecalcMode: (mode: RecalcMode) => void;
  touchDataset: (id: string) => void;
  recalcNow: () => Promise<void>;
  setFitSpec: (id: string, spec: FitSpec | null) => void;
}

export function createRecalcEngineSlice(set: SliceSet, get: SliceGet): RecalcEngineSlice {
  return {
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    // `downstreamOf` (lib/recalc.ts) walks the WIDENED ds/col/sheet/fit
    // graph, so a dataset with `derivedFrom` set (K2, L0.50) lands in
    // `down.datasets`/`down.fits` exactly like a bgRef-chained one — no
    // separate sheet-marking path. That satisfies K5c's "no automatic
    // recompute on source edit beyond stale-marking": `touchDataset` only
    // ever ADDS ids, whether the auto-mode debounce fires or not.
    // `recalcNow` is the async stale-marked scheduler path a sheet
    // recalculates through; its two-phase order (datasets, then
    // `recomputeStaleFits`) processes a ds→sheet→fit chain in the right
    // order inside one pass, because `down.fits` came from the SAME walk.
    setRecalcMode: (recalcMode) => set({ recalcMode }),
    touchDataset: (id) => {
      if (_recalcInProgress) return; // the recalc's own writes never re-mark
      const s = get();
      if (s.recalcMode === "off") return;
      const down = downstreamOf(s.datasets, id);
      const staleDatasets = markStale(s.staleDatasets, down.datasets);
      const staleFits = markStale(s.staleFits, down.fits);
      if (staleDatasets !== s.staleDatasets || staleFits !== s.staleFits) {
        set({ staleDatasets, staleFits });
      }
      if (s.recalcMode === "auto" && (staleDatasets.length || staleFits.length)) {
        // Debounced: a burst of cell edits triggers ONE downstream pass.
        if (_recalcTimer) clearTimeout(_recalcTimer);
        _recalcTimer = setTimeout(() => {
          _recalcTimer = null;
          void get().recalcNow();
        }, 400);
      }
    },
    recalcNow: async () => {
      // #3: a request that arrives mid-pass (refreshFitRefsFor's own call,
      // reached from inside recomputeStaleFits below) sets the pending flag
      // for a follow-up pass below, rather than the silent no-op it used to be.
      if (_recalcInProgress) return void (_recalcPending = true);
      _recalcInProgress = true;
      try {
        await recomputeStaleDatasets(set, get);
        await recomputeStaleFits(set, get);
      } finally {
        _recalcInProgress = false;
        if (_recalcPending) void ((_recalcPending = false), get().recalcNow());
      }
    },
    setFitSpec: (id, spec) => {
      set((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? { ...d, fitSpec: spec ?? undefined } : d)) }));
      refreshFitRefsLater(id, get); // P2.5: fit() columns follow the fit
    },
  };
}
