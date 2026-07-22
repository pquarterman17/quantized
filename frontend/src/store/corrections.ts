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

import { applyCorrections as applyCorrectionsApi, type CorrectionsRequest } from "../lib/api";
import { lit } from "../lib/macro";
import type { CorrectionParams } from "../lib/types";
import { recompute, type AppState } from "./useApp";

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
function clearOverlaysFor(s: AppState, id: string): Partial<AppState> {
  const p: Partial<AppState> = {};
  if (s.fitOverlay?.datasetId === id) p.fitOverlay = null;
  if (s.peakOverlay?.datasetId === id) p.peakOverlay = null;
  if (s.baselineOverlay?.datasetId === id) p.baselineOverlay = null;
  if (s.derivOverlay?.datasetId === id) p.derivOverlay = null;
  return p;
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
        const raw = ds.raw ?? ds.data;
        // Resolve the background only if it points at a real, different dataset.
        const bgDs =
          bg && bg.datasetId !== id ? await get().resolveDataset(bg.datasetId) : undefined;
        const bgRef = bgDs ? { datasetId: bgDs.id, interp: bg!.interp } : undefined;
        const req: CorrectionsRequest = { dataset: raw, params };
        if (bgDs) {
          req.bg_dataset = bgDs.data;
          req.bg_interp = bg!.interp;
        }
        const corrected = await applyCorrectionsApi(req);
        // excludedRows are raw row INDICES into ds.data; an xTrim shrinks/shifts
        // the rows (corrections.py step 1), so carrying stale indices forward would
        // exclude the WRONG rows (or silently lose the exclusion). Drop them when
        // the row count changes rather than corrupt the analysis view.
        const rowsChanged = corrected.time.length !== ds.data.time.length;
        // Recompute any computed columns from the freshly-corrected base.
        get().recordHistory("apply corrections");
        set((s) => ({
          datasets: s.datasets.map((d) =>
            d.id === id
              ? recompute({
                  ...d,
                  data: corrected,
                  raw,
                  corrections: params,
                  bgRef,
                  ...(rowsChanged ? { excludedRows: undefined } : {}),
                })
              : d,
          ),
          // A trim also invalidates the row-indexed fit/peak/baseline/deriv
          // overlays for this dataset (see clearOverlaysFor).
          ...(rowsChanged ? clearOverlaysFor(s, id) : {}),
        }));
        if (rowsChanged && ds.excludedRows?.length) {
          get().setStatus(
            "Row exclusions cleared: a trim changed the row count, so the saved row indices no longer apply.",
          );
        }
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
            return recompute({
              ...d,
              data: d.raw,
              raw: undefined,
              corrections: undefined,
              bgRef: undefined,
              ...(rowsChanged ? { excludedRows: undefined } : {}),
            });
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
