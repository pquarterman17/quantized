// The ROI-gadget compute bodies (bundle diet slice 19, `plans/BUNDLE_HEADROOM.md`).
//
// `store/gadget.ts` keeps the slice: its state, the ROI/model/mode setters, the
// 350 ms debounce, the cursors readout and both Commit actions. The five
// region computes below moved here verbatim and load on the first ROI compute
// of a session. Each one was already reached only through the debounced
// `runGadget` (or a test), and each reads its state when it runs, so loading
// first changes what runs WHEN, never what it computes.
//
// Nothing eager may import this module statically, or the bundler folds it
// back into the entry chunk (`architecture.test.ts`'s SEAMS guard).

import { fftSpectral, fitModel, peaksIntegrate } from "../lib/api";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { statsDescriptive } from "../lib/api/statsDescriptive";
import { centralDifference, sortByX } from "../lib/differentiate";
import { fftColumnOf, fftOutputOf, fftRequestFor } from "../lib/gadgetFftColumn";
import { xUnitOf } from "../lib/errorRoles";
import { gadgetCurve, selectRoiRows } from "../lib/quickfit";
import { expandToFull } from "../lib/rowstate";
import type { DataStruct } from "../lib/types";
import { publishFitAnalysisResult } from "./publishFitAnalysisResult";
import { useGadgetFftOptions } from "./gadgetFftOptions";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** What the slice shares with the bodies: the store and its request sequence. */
export interface GadgetRunCtx {
  set: SliceSet;
  get: SliceGet;
  /** Bump the region-request sequence and return the new value. */
  nextSeq: () => number;
  /** The current sequence; a request whose number differs is stale. */
  seq: () => number;
  /** Drop the current fit result, and the overlay only if this gadget drew it. */
  dropQfitResult: (s: AppState) => Partial<AppState>;
}

/** The five region computes `runGadget` dispatches to. */
export interface GadgetRunner {
  runQuickFit: () => Promise<void>;
  runGadgetIntegrate: () => Promise<void>;
  runGadgetStats: () => Promise<void>;
  runGadgetDifferentiate: () => void;
  runGadgetFft: () => Promise<void>;
  /** Ending action for FFT mode: the live preview becomes a new library dataset. */
  commitGadgetFft: () => void;
  publishFitResult: (datasetId: string) => void;
}

export function createGadgetRun({ set, get, nextSeq, seq: currentSeq, dropQfitResult }: GadgetRunCtx): GadgetRunner {
  // One async region-mode request: only the LATEST may land, and a stale one
  // (ROI/mode moved, gadget cleared, dataset switched) leaves busy to its successor.
  const runRegion = async <T>(
    activeId: string, call: () => Promise<T>, apply: (r: T) => Partial<AppState>, what: string,
  ): Promise<void> => {
    set({ gadgetBusy: true, gadgetError: null });
    const seq = nextSeq();
    const stale = () => seq !== currentSeq() || get().activeId !== activeId || !get().qfitRoi;
    try {
      const r = await call();
      if (!stale()) set({ ...apply(r), gadgetBusy: false });
    } catch (e) {
      if (!stale()) set({ gadgetBusy: false, gadgetError: e instanceof Error ? e.message : `${what} failed` });
    }
  };

  return {
    runQuickFit: async () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return;
      const curve = gadgetCurve(active, s); // the first visible curve, on its OWN X
      const sel = selectRoiRows(active, s.qfitRoi, curve?.yKey ?? null, curve?.xKey ?? null);
      if (sel.x.length < 2) {
        set({ qfitError: "not enough points in the selected region", qfitBusy: false });
        return;
      }
      set({ qfitBusy: true, qfitError: null });
      const seq = nextSeq();
      const model = s.qfitModel;
      // Guard a stale response: the gadget may have been cleared, the ROI or
      // model changed, or the active dataset switched while in flight.
      const stale = () => seq !== currentSeq() || get().activeId !== active.id || !get().qfitRoi;
      try {
        const r = await fitModel({ model, x: sel.x, y: sel.y });
        if (stale()) return;
        set({ qfitResult: r, qfitResultModel: model, qfitResultCurve: curve, qfitBusy: false });
        const yFit = r.yFit as (number | null)[] | undefined;
        if (Array.isArray(yFit) && curve) {
          // yFit aligns to the ROI-sliced rows; expand back to the full row
          // count (null outside the ROI / excluded / filtered) so it overlays
          // the full-length plot x in register — the expandToFull pattern
          // useCurveFit uses for the whole-dataset case (rowstate.ts).
          const y = expandToFull(yFit, sel.rows, active.data.time.length);
          set({ fitOverlay: { datasetId: active.id, binding: curve, y } });
        }
      } catch (e) {
        if (stale()) return;
        set((cur) => ({ ...dropQfitResult(cur), qfitBusy: false, qfitError: e instanceof Error ? e.message : "fit failed" }));
      }
    },
    runGadgetIntegrate: async () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return set({ gadgetBusy: false }); // nothing to compute: never stuck busy
      const curve = gadgetCurve(active, s); // the first visible curve, on its OWN X
      const sel = selectRoiRows(active, s.qfitRoi, curve?.yKey ?? null, curve?.xKey ?? null);
      if (sel.x.length < 2) {
        set({ gadgetError: "not enough points in the selected region", gadgetBusy: false, gadgetIntegrateResult: null });
        return;
      }
      const lo = Math.min(s.qfitRoi[0], s.qfitRoi[1]);
      const hi = Math.max(s.qfitRoi[0], s.qfitRoi[1]);
      await runRegion(
        active.id,
        () => peaksIntegrate({ x: sel.x, y: sel.y, regions: [[lo, hi]], baseline: "linear" }),
        (r) => ({ gadgetIntegrateResult: r }),
        "integrate",
      );
    },
    runGadgetStats: async () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return set({ gadgetBusy: false }); // nothing to compute: never stuck busy
      const curve = gadgetCurve(active, s); // the first visible curve, on its OWN X
      const sel = selectRoiRows(active, s.qfitRoi, curve?.yKey ?? null, curve?.xKey ?? null);
      if (sel.y.length < 1) {
        set({ gadgetError: "not enough points in the selected region", gadgetBusy: false, gadgetStatsResult: null });
        return;
      }
      await runRegion(active.id, () => statsDescriptive(sel.y), (r) => ({ gadgetStatsResult: r }), "stats");
    },
    // Synchronous once loaded (client-side central differences) — no busy
    // state, but shares `gadgetError` with the async modes for a consistent
    // chip error slot.
    runGadgetDifferentiate: () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return;
      const curve = gadgetCurve(active, s); // the first visible curve, on its OWN X
      const sel = selectRoiRows(active, s.qfitRoi, curve?.yKey ?? null, curve?.xKey ?? null);
      const result = centralDifference(sel.x, sel.y);
      if (!result) {
        set({ gadgetError: "not enough points in the selected region", gadgetDerivResult: null, derivOverlay: null });
        return;
      }
      set({ gadgetError: null, gadgetDerivResult: result });
      const y = expandToFull(result.dydx, sel.rows, active.data.time.length);
      if (curve) set({ derivOverlay: { datasetId: active.id, binding: curve, y } });
    },
    runGadgetFft: async () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return set({ gadgetBusy: false }); // nothing to compute: never stuck busy
      const curve = gadgetCurve(active, s); // the first visible curve, on its OWN X
      const sel = selectRoiRows(active, s.qfitRoi, curve?.yKey ?? null, curve?.xKey ?? null);
      if (sel.x.length < 4) {
        set({ gadgetError: "need at least 4 points in the selected region", gadgetBusy: false, gadgetFftPreview: null });
        return;
      }
      // FFT assumes evenly-sampled, ascending x (fs = 1/mean(diff(x))); ROI rows
      // arrive in acquisition order, which may not be monotonic (loops/swept-
      // back scans) — sort before sending (same discipline as differentiate).
      const sorted = sortByX(sel.x, sel.y);
      // Stamp the preview with the source it was computed on (taken BEFORE the
      // request): "Add" commits through the shared contract (store/commitComputedOutput.ts),
      // which refuses once that worksheet has changed, and marks the output out of date after.
      const source = { id: active.id, computedOn: analysisDataFingerprint(active), roi: [...s.qfitRoi] as [number, number], xKey: curve?.xKey ?? null, yKey: curve?.yKey ?? null };
      await runRegion(active.id, () => fftSpectral({ x: sorted.x, y: sorted.y, ...fftRequestFor(useGadgetFftOptions.getState().output) }), (r) => ({ gadgetFftPreview: { ...r, source } }), "FFT");
    },
    // Ending action for FFT mode: the live preview becomes a new library dataset
    // (there's no fitSpec-like durable slot for a spectrum) — mirrors "Commit"
    // for the other modes, but adds to the library instead of writing a spec.
    commitGadgetFft: () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      const r = s.gadgetFftPreview;
      if (!active || !r) return;
      const freq = Array.isArray(r.freq) ? r.freq : [];
      const source = r.source;
      const yUnit = source?.yKey == null ? "" : (active.data.units[source.yKey] ?? "");
      const xUnit = source?.xKey == null ? xUnitOf(active.data.metadata) : (active.data.units[source.xKey] ?? "");
      const col = fftColumnOf(r, yUnit, xUnit);
      const output = fftOutputOf(r);
      const mag = Array.isArray(col.values) ? col.values : Array.isArray(r.phase) ? r.phase : [];
      const data: DataStruct = {
        time: freq,
        values: mag.map((v) => [v ?? Number.NaN]),
        labels: [col.label],
        units: [col.unit],
        // `fftOutput` (not `output`: that settings key is the commit's own) is recorded only when it is not the default magnitude spectrum.
        metadata: { source: "fft gadget", sourceDataset: active.name, window: r.windowName, ...(output === "magnitude" ? {} : { fftOutput: output }) },
      };
      if (!source || source.id !== active.id) {
        const why = "FFT gadget: this spectrum was not computed on the active worksheet; move the region to compute it again before adding it";
        get().setStatus(why, "danger");
        toast(why, "danger");
        return;
      }
      // The shared commit contract (lazy: it is not part of the entry chunk): ONE
      // undo step with a Library result, no duplicate on a repeat click, and the
      // output goes out of date when its source worksheet changes.
      void import("./commitComputedOutput").then(({ commitComputedOutput }) => {
        const outcome = commitComputedOutput({
          producer: { id: "gadget-fft", label: "Gadget FFT", version: 2 },
          sources: [{ id: source.id, computedOn: source.computedOn }],
          settings: { roi: source.roi, xKey: source.xKey, yKey: source.yKey, window: r.windowName ?? null, ...(output === "magnitude" ? {} : { fftOutput: output }) },
          // Unkeyed: the channels "Open in Gadget FFT" proves are still where they were (position AND name).
          ...(source.yKey === null ? {} : { reopenExtra: { channels: { xLabel: source.xKey === null ? null : (active.data.labels[source.xKey] ?? ""), yLabel: active.data.labels[source.yKey] ?? "", xIndex: source.xKey, yIndex: source.yKey } } }),
          xKey: source.xKey,
          name: `${active.name} — FFT`,
          data,
          status: "FFT spectrum added to library",
        });
        if (outcome.kind === "created" || outcome.kind === "replaced") toast("FFT spectrum added to library", "ok");
      }, () => {
        const why = "FFT gadget: the commit code failed to load; nothing was added. Try again.";
        get().setStatus(why, "danger");
        toast(why, "danger");
      });
    },
    publishFitResult: publishFitAnalysisResult,
  };
}
