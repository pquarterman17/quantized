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
import { statsDescriptive } from "../lib/api/statsDescriptive";
import { centralDifference, sortByX } from "../lib/differentiate";
import { effectiveChannels } from "../lib/plotdata";
import { firstVisiblePlottedChannel, selectRoiRows } from "../lib/quickfit";
import { expandToFull } from "../lib/rowstate";
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
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, s.qfitRoi, col);
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
        set({ qfitResult: r, qfitResultModel: model, qfitBusy: false });
        const yFit = r.yFit as (number | null)[] | undefined;
        if (Array.isArray(yFit)) {
          // yFit aligns to the ROI-sliced rows; expand back to the full row
          // count (null outside the ROI / excluded / filtered) so it overlays
          // the full-length plot x in register — the expandToFull pattern
          // useCurveFit uses for the whole-dataset case (rowstate.ts).
          const y = expandToFull(yFit, sel.rows, active.data.time.length);
          set({ fitOverlay: { datasetId: active.id, y } });
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
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, s.qfitRoi, col);
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
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, s.qfitRoi, col);
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
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, s.qfitRoi, col);
      const result = centralDifference(sel.x, sel.y);
      if (!result) {
        set({ gadgetError: "not enough points in the selected region", gadgetDerivResult: null, derivOverlay: null });
        return;
      }
      set({ gadgetError: null, gadgetDerivResult: result });
      const y = expandToFull(result.dydx, sel.rows, active.data.time.length);
      set({ derivOverlay: { datasetId: active.id, y } });
    },
    runGadgetFft: async () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return set({ gadgetBusy: false }); // nothing to compute: never stuck busy
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, s.qfitRoi, col);
      if (sel.x.length < 4) {
        set({ gadgetError: "need at least 4 points in the selected region", gadgetBusy: false, gadgetFftPreview: null });
        return;
      }
      // FFT assumes evenly-sampled, ascending x (fs = 1/mean(diff(x))); ROI rows
      // arrive in acquisition order, which may not be monotonic (loops/swept-
      // back scans) — sort before sending (same discipline as differentiate).
      const sorted = sortByX(sel.x, sel.y);
      await runRegion(active.id, () => fftSpectral({ x: sorted.x, y: sorted.y }), (r) => ({ gadgetFftPreview: r }), "FFT");
    },
  };
}
