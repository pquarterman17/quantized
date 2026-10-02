// The `applyCorrections` and `applyCorrectionsToMany` bodies, moved verbatim
// out of store/corrections.ts (bundle diet slice 21, plans/BUNDLE_HEADROOM.md).
// Both actions were already async and awaited before touching state, so the
// slice loads this module first and then runs it: what they compute is
// unchanged. The slice keeps their synchronous refusals (a derived worksheet,
// a source with no corrections) and reports a chunk that will not load
// ("Corrections failed to load: …", nothing applied).
//
// The API call, `rowsChangedGuard` and the cycle check are passed in rather
// than imported: each lives in an eager chunk shared with other code, and a
// lazy import of it splits it into a chunk of its own (the slice-17 boundary
// tax; lib/recalc.ts measured +2,245 B of new chunk). Nothing eager may
// value-import this module (architecture.test.ts's SEAMS list).

import type { applyCorrections as applyCorrectionsFn, CorrectionsRequest } from "../lib/api";
import { baseColumns } from "../lib/formula";
import { recomputeFromBaseOrEmpty } from "../lib/formulaInputs";
import { lit } from "../lib/macro";
import { plural } from "../lib/plural";
import type { recalcNodes as recalcNodesT, wouldCreateCycle as wouldCreateCycleFn } from "../lib/recalc";
import type { CorrectionParams, Dataset } from "../lib/types";
import type { rowsChangedGuard as rowsChangedGuardFn } from "./corrections";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** What the eager slice hands the body (see this file's header). */
export interface CorrectionsRunDeps {
  applyCorrectionsApi: typeof applyCorrectionsFn;
  rowsChangedGuard: typeof rowsChangedGuardFn;
  recalcNodes: typeof recalcNodesT;
  wouldCreateCycle: typeof wouldCreateCycleFn;
}

export async function runApplyCorrections(
  set: SliceSet,
  get: SliceGet,
  deps: CorrectionsRunDeps,
  id: string,
  params: CorrectionParams,
  bg?: { datasetId: string; interp: string },
): Promise<boolean> {
  const { applyCorrectionsApi, rowsChangedGuard, recalcNodes, wouldCreateCycle } = deps;
  try {
    // #38 deferred edge: corrections must never compute on a still-pending
    // (preview-only) dataset — resolve the target AND any bg reference to
    // full data first. A resolve failure lands in the catch below, reusing
    // the existing "corrections failed" status/toast rather than silently
    // falling through to the preview.
    const ds = await get().resolveDataset(id);
    if (!ds) return false;
    // #6: always base-only, matching store/reimport.ts -- never `ds.data`
    // verbatim, which may already carry stale computed columns.
    const raw = ds.raw ?? baseColumns(ds.data, ds.formulas?.length ?? 0);
    // Resolve the background only if it points at a real, different dataset.
    const bgDs =
      bg && bg.datasetId !== id ? await get().resolveDataset(bg.datasetId) : undefined;
    const bgRef = bgDs ? { datasetId: bgDs.id, interp: bg!.interp } : undefined;
    // AUDITABILITY (review round, #331): a `bgRef` that no longer resolves
    // — its background dataset was deleted — used to be handled in total
    // silence: the correction re-ran WITHOUT the background subtraction,
    // `bgRef` was written back as undefined below, and this returned
    // `true`. The user's numbers changed and their background reference
    // vanished with no indication either had happened. That is exactly the
    // "never hide an automatic correction" case, so say it out loud. The
    // correction still proceeds (refusing would leave the dataset
    // permanently un-recalculable once a background is deleted); it is the
    // SILENCE that was the defect, not the fallback.
    // LIBRARY_WORKBOOK_UX_PLAN PR K (K4): write-time cycle rejection —
    // refuse BEFORE calling the API, with zero mutation, when picking
    // `bgDs` as this dataset's background would close a loop (the
    // constructible-today A↔B case: B already subtracts A, now A tries
    // to subtract B).
    if (bgRef) {
      const reason = wouldCreateCycle(get().datasets, {
        from: recalcNodes.dataset(bgRef.datasetId),
        to: recalcNodes.dataset(id),
      });
      if (reason) {
        get().setStatus(`Can't set "${bgDs!.name}" as the background: ${reason}`);
        return false;
      }
    }
    const req: CorrectionsRequest = { dataset: raw, params, error_bindings: ds.errorRoles };
    if (bgDs) {
      req.bg_dataset = bgDs.data;
      req.bg_interp = bg!.interp;
    }
    const corrected = await applyCorrectionsApi(req);
    // excludedRows are raw row INDICES into ds.data; an xTrim shrinks/shifts
    // the rows (corrections.py step 1), so carrying stale indices forward would
    // exclude the WRONG rows (or silently lose the exclusion). Drop them when
    // the row count changes rather than corrupt the analysis view (#50/#53
    // guard, shared with derivedWorksheets.ts's recompute — rowsChangedGuard).
    const rowsChanged = corrected.time.length !== ds.data.time.length;
    // Recompute any computed columns from the freshly-corrected base.
    get().recordHistory("apply corrections");
    let statusMsg: string | undefined;
    set((s) => {
      const guard = rowsChangedGuard(s, id, rowsChanged, ds.excludedRows);
      statusMsg = guard.statusMessage;
      return {
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const patch = recomputeFromBaseOrEmpty(corrected, d.formulas);
          // peakTable: any correction re-derives the numbers the fit was
          // measured from — an xOff shifts every 2-theta with the row count
          // unchanged, so `guard.datasetPatch` alone would keep a table
          // whose centers are all off by the offset just applied.
          return { ...d, ...patch, raw, corrections: params, bgRef, peakTable: undefined, ...guard.datasetPatch };
        }),
        ...guard.statePatch,
      };
    });
    // Folded into the ONE existing status call, and the single-use flag
    // inlined: same message, one call site, no extra branch or const. The
    // extra branch put the eager bundle 0.1 kB over budget, and a pin raise
    // is the last resort — this is what recovered it.
    if (bg && bg.datasetId !== id && !bgDs) {
      statusMsg = `Background "${ds.name}" is missing — recalculated without it.`;
    }
    if (statusMsg) get().setStatus(statusMsg);
    get().recordMacro(
      `Corrections → ${ds.name}`,
      bgDs
        ? `qz.applyCorrections(${lit(ds.name)}, ${lit(params)}, ${lit({ bg: bgDs.name, interp: bg!.interp })})`
        : `qz.applyCorrections(${lit(ds.name)}, ${lit(params)})`,
      { kind: "correction", params: { params, bg } },
    );
    get().touchDataset(id); // recalc graph (#1): data changed
    return true;
  } catch (e) {
    get().setStatus(
      `corrections failed: ${e instanceof Error ? e.message : "error"}`,
    );
    return false; // callers can see failure (review 2026-07-11)
  }
}

/** The `applyCorrectionsToMany` loop and summary, moved verbatim (the slice
 *  keeps the "no corrections on the source" refusal). Each target goes
 *  through the store's own `applyCorrections`. */
export async function runApplyCorrectionsToMany(
  get: SliceGet,
  src: Dataset,
  corrections: CorrectionParams,
  sourceId: string,
  targetIds: string[],
): Promise<number> {
  const bg = src.bgRef ? { datasetId: src.bgRef.datasetId, interp: src.bgRef.interp } : undefined;
  let n = 0;
  const failed: string[] = [];
  for (const id of targetIds) {
    if (id === sourceId) continue;
    // Don't subtract a dataset from itself if it's the shared bg reference.
    const useBg = bg && bg.datasetId !== id ? bg : undefined;
    const transferable = { ...corrections }; // anchors are hand-traced on the SOURCE curve - not transferable
    delete transferable.bgAnchors;
    delete transferable.bgAnchorMethod;
    // Silent-failure audit (2026-10-01): a target that failed or was
    // refused is never counted as applied, and the summary below names
    // it rather than overwriting its own "corrections failed" status.
    if (await get().applyCorrections(id, transferable, useBg)) n += 1;
    else failed.push(get().datasets.find((d) => d.id === id)?.name ?? id);
  }
  if (failed.length === 0) {
    get().setStatus(`applied ${src.name}'s corrections to ${n} dataset${plural(n)}`);
    return n;
  }
  const msg = `applied ${src.name}'s corrections to ${n} of ${n + failed.length} datasets — failed: ${failed.join(", ")}`;
  get().setStatus(msg);
  toast(msg, "danger");
  return n;
}
