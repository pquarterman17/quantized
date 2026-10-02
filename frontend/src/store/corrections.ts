// The corrections slice: apply/reset a dataset's baseline-correction pipeline
// (+ the "apply to many" batch action), extracted out of useApp.ts under the
// store-size ratchet (architecture.test.ts's STORE_PINS) exactly like
// store/reimport.ts / store/split.ts: useApp.ts sits AT its pin with zero
// headroom, so a self-contained feature's actions live here instead of
// inline. This slice owns no state of its own — `datasets` stays a plain
// field on the composed AppState (declared in useApp.ts) — it mutates it
// through `set`/`get` exactly like store/reimport.ts's inline re-apply does
// (the established precedent for a slice that acts on shared state it
// doesn't own).
//
// Corrections always apply to the pristine `raw`, never to an already-
// corrected `data` (the MATLAB pipeline is replace, not accumulate). The
// first import becomes `raw`; re-applying with new params re-derives `data`.
// An optional `bg` picks another loaded dataset as the reference background
// (step 4 of the pipeline): we forward its CURRENT `data` + the interp method
// so the golden /api/corrections/apply does the interpolated subtraction.
//
// SILENT_STATE_CORRUPTION_PLAN #6 (refuting the plan's earlier "audited and
// cleared" record): `Dataset.raw` is ALWAYS BASE-ONLY -- it never carries
// computed/formula columns, matching store/reimport.ts's definition exactly.
// The old `raw = ds.raw ?? ds.data` capture was only honest at the INSTANT
// of the first apply (when `ds.data`'s width happened to match the formula
// count); `addFormula`/`removeFormula` change `data`'s width afterward and
// never touched `raw`, so the two drifted apart across the dataset's
// lifecycle and the next apply/reset fed a wrong-width `raw` into a
// STRIPPING recompute -- deleting real columns or inventing a phantom
// duplicate. Both `applyCorrections` and `resetCorrections` now route
// through the non-stripping `recomputeFromBaseOrEmpty` (lib/formulaInputs.ts)
// on the base-only table, exactly like #245/#4 did for reimport/
// derivedWorksheets. (store/derivedWorksheets.ts's OWN use of `.raw` as "a
// cache of the SOURCE's data" is a documented, deliberate exception for that
// cross-dataset case — see its module doc — and never reaches this slice.)

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import { onDemand } from "../lib/onDemand";
import { recomputeFromBaseOrEmpty } from "../lib/formulaInputs";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { CorrectionParams } from "../lib/types";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

// The apply bodies (store/correctionsRun.ts) load on the first apply (bundle
// diet slice 21). A failed load is not cached, so the next apply retries.
const applyRun = onDemand(() => import("./correctionsRun"));

/** Test-only: forget the loaded body so a spec can exercise the cold path. */
export function resetCorrectionsRunForTests(): void {
  applyRun.resetForTests();
}

export interface CorrectionsSlice {
  applyCorrections: (
    id: string,
    params: CorrectionParams,
    bg?: { datasetId: string; interp: string },
  ) => Promise<boolean>;
  resetCorrections: (id: string) => void;
  // Copy `sourceId`'s correction params (+ bg reference) onto every target id,
  // re-deriving each from its own raw. Batch parity with MATLAB "Apply to All".
  // Resolves to how many targets actually applied (a failed one is named in
  // the status + a danger toast, never counted).
  applyCorrectionsToMany: (sourceId: string, targetIds: string[]) => Promise<number>;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

// The four analysis overlays (fit/peak/baseline/deriv) are singleton AppState
// fields: a row-indexed y-array tagged with the datasetId it was built for. A
// corrections xTrim changes the row count AND, for a FRONT trim (the `x_min`
// mask, corrections.py step 1), shifts WHICH rows survive — so a full-length
// overlay can no longer be aligned onto the trimmed payload. `alignOverlayY`
// only sees array lengths, assumes a TAIL trim, and `.slice(0, target)` would
// draw the fit/baseline curve at a visibly wrong x-offset (persistent when
// recalcMode is manual/off, which has no self-heal). Drop any overlay belonging
// to the re-derived dataset — same reasoning the excludedRows guard uses — and
// leave overlays for OTHER datasets untouched. The owning workshop recomputes
// on its next run.
const OVERLAY_FIELDS = ["fitOverlay", "peakOverlay", "baselineOverlay", "derivOverlay"] as const;

export function clearOverlaysFor(s: AppState, id: string): Partial<AppState> {
  const p: Partial<AppState> = {};
  for (const k of OVERLAY_FIELDS) if (s[k]?.datasetId === id) p[k] = null;
  return p;
}

/** Review round P1-2: the #50/#53 row-count-changed guard — excludedRows
 *  (raw row INDICES into `.data`, invalidated the same way a trim shifts
 *  them here) and the four singleton overlays — extracted into ONE shared
 *  helper so `applyCorrections` (in-place re-correction) and
 *  `store/derivedWorksheets.ts`'s cross-dataset recompute (via useApp.ts's
 *  `recalcNow`) can't drift: duplicating this by hand is exactly how the
 *  reviewer's probe (a row-count-changing derived-sheet recompute leaving
 *  excludedRows out-of-bounds and every overlay stale) happened. Pure —
 *  takes a state snapshot, returns the dataset-level patch, the AppState-
 *  level patch, and the status message to surface (if any); the caller
 *  performs the actual `set()`/`setStatus()`. */
export function rowsChangedGuard(
  s: AppState,
  id: string,
  rowsChanged: boolean,
  priorExcludedRows: number[] | undefined,
): {
  datasetPatch: { excludedRows?: undefined; peakTable?: undefined };
  statePatch: Partial<AppState>;
  statusMessage?: string;
} {
  if (!rowsChanged) return { datasetPatch: {}, statePatch: {} };
  return {
    // `peakTable` (audit P2.1, review round 2) joins excludedRows for the same
    // reason the overlays do: a row-count change means the fitted peaks were
    // measured from data that no longer exists. See lib/peakTable.ts's
    // INVALIDATION header for why the durable fingerprint is the other half.
    datasetPatch: { excludedRows: undefined, peakTable: undefined },
    statePatch: clearOverlaysFor(s, id),
    statusMessage: priorExcludedRows?.length
      ? "Row exclusions cleared: a trim changed the row count, so the saved row indices no longer apply."
      : undefined,
  };
}

/** SILENT_STATE_CORRUPTION_PLAN #10. A derived worksheet's `.raw` is the
 *  documented exception to this slice's base-only rule: it caches its SOURCE's
 *  table, not its own base (see store/derivedWorksheets.ts's module doc). This
 *  slice's header long ASSERTED that case "never reaches this slice" -- but
 *  nothing enforced it, and several callers can: Inspector's CorrectionsCard
 *  mounted for any active dataset, plus folderOps' bulk apply, the pipeline
 *  workshop, and the baseline workshop.
 *
 *  Correcting through this slice then rebuilds the sheet from that CACHE
 *  instead of the source's CURRENT data, which `recomputeDerivedSheet` reads
 *  live. Proven: with the source moved on to [999, 888, 777], an apply on the
 *  sheet still produced [20, 40, 60] -- values derived from a version of the
 *  source that no longer exists, with no error and no toast.
 *
 *  A derived sheet's `.corrections` IS its re-runnable pipeline recipe and is
 *  owned by `recomputeDerivedSheet`; there is no "edit an existing sheet's
 *  pipeline" action, so refusing here loses no capability. `freezeCopy` is the
 *  honest path to an independently correctable dataset. */
function refuseDerived(get: SliceGet, id: string): boolean {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds?.derivedFrom) return false;
  get().setStatus(
    `"${ds.name}" is a derived worksheet — its corrections re-run from its source. ` +
      `Use Freeze copy to make an independent dataset you can correct.`,
  );
  return true;
}

export function createCorrectionsSlice(set: SliceSet, get: SliceGet): CorrectionsSlice {
  // The loaded body, or null once a load failure has been reported (status +
  // danger toast, nothing applied).
  const loadRun = async (): Promise<typeof import("./correctionsRun") | null> => {
    try {
      return await applyRun.core();
    } catch (e) {
      const msg = `Corrections failed to load: ${e instanceof Error ? e.message : "error"}`;
      get().setStatus(msg);
      toast(msg, "danger");
      return null;
    }
  };
  return {
    applyCorrections: async (id, params, bg) => {
      if (refuseDerived(get, id)) return false;
      const run = await loadRun();
      return run ? run.runApplyCorrections(set, get, { applyCorrectionsApi, rowsChangedGuard, recalcNodes, wouldCreateCycle }, id, params, bg) : false;
    },
    resetCorrections: (id) => {
      if (refuseDerived(get, id)) return;
      const ds = get().datasets.find((d) => d.id === id);
      get().recordHistory("reset corrections");
      set((s) => {
        const target = s.datasets.find((d) => d.id === id);
        // Reverting a trim restores rows, so index-based row state (excludedRows
        // + the four overlays) is stale — clear it, same as the apply path.
        const rowsChanged = !!target?.raw && target.raw.time.length !== target.data.time.length;
        return {
          datasets: s.datasets.map((d) => {
            if (d.id !== id || !d.raw) return d;
            const patch = recomputeFromBaseOrEmpty(d.raw, d.formulas);
            return {
              ...d,
              ...patch,
              raw: undefined,
              corrections: undefined,
              bgRef: undefined,
              ...(rowsChanged ? { excludedRows: undefined } : {}),
            };
          }),
          ...(rowsChanged ? clearOverlaysFor(s, id) : {}),
        };
      });
      if (ds?.raw) {
        get().recordMacro(`Reset corrections → ${ds.name}`, `qz.resetCorrections(${lit(ds.name)})`, {
          kind: "reset",
          params: {},
        });
      }
      get().touchDataset(id); // recalc graph (#1): data changed
    },
    applyCorrectionsToMany: async (sourceId, targetIds) => {
      const src = get().datasets.find((d) => d.id === sourceId);
      if (!src?.corrections) {
        get().setStatus("no corrections on the source dataset to copy");
        return 0;
      }
      const run = await loadRun();
      return run ? run.runApplyCorrectionsToMany(get, src, src.corrections, sourceId, targetIds) : 0;
    },
  };
}
