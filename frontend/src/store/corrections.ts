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

import { applyCorrections as applyCorrectionsApi, type CorrectionsRequest } from "../lib/api";
import { baseColumns } from "../lib/formula";
import { recomputeFromBaseOrEmpty } from "../lib/formulaInputs";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { CorrectionParams } from "../lib/types";
import type { AppState } from "./useApp";

export interface CorrectionsSlice {
  applyCorrections: (
    id: string,
    params: CorrectionParams,
    bg?: { datasetId: string; interp: string },
  ) => Promise<boolean>;
  resetCorrections: (id: string) => void;
  // Copy `sourceId`'s correction params (+ bg reference) onto every target id,
  // re-deriving each from its own raw. Batch parity with MATLAB "Apply to All".
  applyCorrectionsToMany: (sourceId: string, targetIds: string[]) => Promise<void>;
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
export function clearOverlaysFor(s: AppState, id: string): Partial<AppState> {
  const p: Partial<AppState> = {};
  if (s.fitOverlay?.datasetId === id) p.fitOverlay = null;
  if (s.peakOverlay?.datasetId === id) p.peakOverlay = null;
  if (s.baselineOverlay?.datasetId === id) p.baselineOverlay = null;
  if (s.derivOverlay?.datasetId === id) p.derivOverlay = null;
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
): { datasetPatch: { excludedRows?: undefined }; statePatch: Partial<AppState>; statusMessage?: string } {
  if (!rowsChanged) return { datasetPatch: {}, statePatch: {} };
  return {
    datasetPatch: { excludedRows: undefined },
    statePatch: clearOverlaysFor(s, id),
    statusMessage: priorExcludedRows?.length
      ? "Row exclusions cleared: a trim changed the row count, so the saved row indices no longer apply."
      : undefined,
  };
}

export function createCorrectionsSlice(set: SliceSet, get: SliceGet): CorrectionsSlice {
  return {
    applyCorrections: async (id, params, bg) => {
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
        const req: CorrectionsRequest = { dataset: raw, params };
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
              return { ...d, ...patch, raw, corrections: params, bgRef, ...guard.datasetPatch };
            }),
            ...guard.statePatch,
          };
        });
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
    },
    resetCorrections: (id) => {
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
        return;
      }
      const bg = src.bgRef ? { datasetId: src.bgRef.datasetId, interp: src.bgRef.interp } : undefined;
      let n = 0;
      for (const id of targetIds) {
        if (id === sourceId) continue;
        // Don't subtract a dataset from itself if it's the shared bg reference.
        const useBg = bg && bg.datasetId !== id ? bg : undefined;
        const transferable = { ...src.corrections }; // anchors are hand-traced on the SOURCE curve - not transferable
        delete transferable.bgAnchors;
        delete transferable.bgAnchorMethod;
        await get().applyCorrections(id, transferable, useBg);
        n += 1;
      }
      get().setStatus(`applied ${src.name}'s corrections to ${n} dataset${n === 1 ? "" : "s"}`);
    },
  };
}
