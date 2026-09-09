// The ROI-gadget / quick-fit slice: drag a region on the plot and get a live,
// debounced compute over its rows — fit (#33), then generalized (#34) to
// integrate/stats/differentiate/fft modes on the same chip, plus a paired-
// cursors readout that isn't ROI-scoped at all. Extracted out of useApp.ts
// under the store-size ratchet (architecture.test.ts's STORE_PINS), mirroring
// store/windows.ts: this slice owns its OWN state (unlike store/corrections.ts,
// which only mutates the shared `datasets` field) — every qfit*/gadget* field
// below moved here as a genuine unit, composed into AppState exactly like
// WindowsSlice.
//
// Cohesion: nothing outside this file calls any of these actions or writes
// any of these fields (confirmed by grep across store/*.ts before the move —
// only store/windows.ts's `focusTransientReset`/`focusedRebindPatch` and
// useApp.ts's own `addDataset` reset a few of these fields back to their
// initial values on a focus/dataset switch, the same plain-object-literal
// pattern corrections.ts already uses for the shared overlay fields). The
// two dedicated test files, store/quickfit.test.ts and store/gadget.test.ts,
// already exercised this exact boundary before this extraction — strong
// independent evidence it was already a natural module, not an arbitrary cut.
//
// Undo-history contract (pinned by store/gadgetHistory.characterization.test.ts,
// written before this move): every action here is TRANSIENT TOOL STATE and
// never calls `recordHistory` itself — history.ts's module doc excludes
// "transient tool/selection state" from the undoable set on purpose. The one
// action that still records an undo entry, `commitGadgetFft`, does so only
// because it calls the general-purpose `addDataset` (which does record); the
// gadget action itself stays history-silent.

import { fftSpectral, fitModel, peaksIntegrate, type FftSpectralResult, type IntegrateResponse } from "../lib/api";
import { statsDescriptive } from "../lib/api/statsDescriptive";
import { centralDifference, sortByX, type DerivativeResult } from "../lib/differentiate";
import { fitStepParams } from "../lib/fitselection";
import { computeCursorReadout } from "../lib/gadgetCursors";
import { lit } from "../lib/macro";
import type { Measurement } from "../lib/measure";
import { effectiveChannels } from "../lib/plotdata";
import {
  firstVisiblePlottedChannel,
  qfitSpec,
  selectRoiRows,
  type GadgetMode,
} from "../lib/quickfit";
import { expandToFull } from "../lib/rowstate";
import type { CalcResult, DataStruct, FitOverlay } from "../lib/types";
import { toast } from "./toasts";
import { nextDatasetId, type AppState } from "./useApp";

/** The ROI-gadget / quick-fit state + actions composed into `useApp`. */
export interface GadgetSlice {
  // Quick-fit gadget (#33): drag an ROI band; a debounced live fit of that
  // region's rows (guard #11: rowstate.analysisData ∩ the ROI) overlays the
  // plot via the shared `fitOverlay` slot (only one fit curve shows at a
  // time — same slot the Curve Fit workshop/recalc use). The chip's explicit
  // "Commit" action durably adopts the model as the dataset's fitSpec; the
  // live drag preview never does (auto-committing every move would spam the
  // recalc graph). Cleared on tool switch, Escape, dataset change, or ✕.
  qfitRoi: [number, number] | null;
  qfitModel: string;
  qfitBusy: boolean;
  qfitResult: CalcResult | null;
  qfitError: string | null;
  // ROI gadget family (#34): generalizes the #33 frame above with a mode
  // selector on the SAME chip. `gadgetMode` picks which of the region's rows
  // gets computed on every ROI move (fit uses the #33 fields above); the other
  // async modes (integrate/stats/fft) share one busy/error pair since only one
  // mode runs at a time. `derivOverlay` mirrors `fitOverlay`'s shape but draws
  // on the secondary axis (a derivative's scale rarely matches the data's).
  // Cursors mode doesn't use the ROI band at all — see `gadgetCursors` below.
  gadgetMode: GadgetMode;
  gadgetBusy: boolean;
  gadgetError: string | null;
  gadgetIntegrateResult: IntegrateResponse | null;
  gadgetStatsResult: CalcResult | null;
  gadgetDerivResult: DerivativeResult | null;
  derivOverlay: FitOverlay | null;
  /** Live FFT preview (recomputed on every ROI move, like the other modes);
   *  "Commit" turns it into a new library dataset (`commitGadgetFft`) rather
   *  than a durable per-dataset spec — there's nothing fitSpec-like to write. */
  gadgetFftPreview: FftSpectralResult | null;
  /** Paired-cursors mode: two independent x positions (unordered — order
   *  carries the Δx/slope sign), placed/dragged by `gadgetCursorsPlugin`. */
  gadgetCursors: [number, number] | null;
  gadgetCursorResult: Measurement | null;

  setQfitRoi: (roi: [number, number] | null) => void;
  setQfitModel: (model: string) => void;
  runQuickFit: () => Promise<void>;
  commitQfit: () => void;
  setGadgetMode: (mode: GadgetMode) => void;
  runGadget: () => Promise<void>;
  runGadgetIntegrate: () => Promise<void>;
  runGadgetStats: () => Promise<void>;
  runGadgetDifferentiate: () => void;
  runGadgetFft: () => Promise<void>;
  commitGadgetFft: () => void;
  setGadgetCursors: (cursors: [number, number] | null) => void;
  clearQfit: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createGadgetSlice(set: SliceSet, get: SliceGet): GadgetSlice {
  // Quick-fit gadget internals (#33): a module-level debounce timer, mirroring
  // the recalc scheduler in useApp.ts — a burst of ROI-drag moves triggers ONE fit.
  let qfitTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    qfitRoi: null,
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: null,
    qfitError: null,
    gadgetMode: "fit",
    gadgetBusy: false,
    gadgetError: null,
    gadgetIntegrateResult: null,
    gadgetStatsResult: null,
    gadgetDerivResult: null,
    derivOverlay: null,
    gadgetFftPreview: null,
    gadgetCursors: null,
    gadgetCursorResult: null,

    // ── Quick-fit gadget (#33) ────────────────────────────────────────────────
    setQfitRoi: (roi) => {
      set({ qfitRoi: roi });
      if (qfitTimer) {
        clearTimeout(qfitTimer);
        qfitTimer = null;
      }
      if (!roi) {
        // A cleared ROI (sub-6px click, or an explicit clear) drops every
        // region-mode's result + chip; only null the shared fit/deriv overlay if
        // THIS gadget set it (a result was ever produced) — never clobber an
        // unrelated overlay (e.g. the Curve Fit workshop's own fitOverlay) just
        // because the tool was touched.
        set((s) => ({
          qfitResult: null,
          qfitBusy: false,
          qfitError: null,
          fitOverlay: s.qfitResult != null ? null : s.fitOverlay,
          gadgetBusy: false,
          gadgetError: null,
          gadgetIntegrateResult: null,
          gadgetStatsResult: null,
          gadgetDerivResult: null,
          derivOverlay: s.gadgetDerivResult != null ? null : s.derivOverlay,
          gadgetFftPreview: null,
        }));
        return;
      }
      // Debounced: a burst of drag-move events triggers ONE compute request.
      qfitTimer = setTimeout(() => {
        qfitTimer = null;
        void get().runGadget();
      }, 350);
    },
    setQfitModel: (qfitModel) => {
      set({ qfitModel });
      // Switching model while an ROI is active refits it (debounced, like a move).
      if (get().qfitRoi) get().setQfitRoi(get().qfitRoi);
    },
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
      try {
        const r = await fitModel({ model: s.qfitModel, x: sel.x, y: sel.y });
        // Guard a stale response: the gadget may have been cleared, or the
        // active dataset switched, while the request was in flight.
        const cur = get();
        if (cur.activeId !== active.id || !cur.qfitRoi) return;
        set({ qfitResult: r, qfitBusy: false });
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
        set({ qfitBusy: false, qfitError: e instanceof Error ? e.message : "fit failed" });
      }
    },
    commitQfit: () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitResult) return;
      // Durable fit spec (audit P1 #3): records the plotted channels the gadget
      // fit (first visible plotted channel + xKey), reused as the step params so
      // a template batch replays those channels, not time/values[0]. The ROI only
      // shaped which rows the user previewed (preview-only — never encoded).
      const spec = qfitSpec(active, s, s.qfitModel, s.qfitResult);
      get().recordMacro(`Fit ${s.qfitModel}`, `qz.fit(${lit(s.qfitModel)})`, {
        kind: "fit",
        params: fitStepParams(s.qfitModel, spec),
      });
      get().setFitSpec(active.id, spec);
    },
    // ── ROI gadget family (#34) — generalizes the frame above ─────────────────
    // Mode switch: re-triggers a live ROI's compute for the new mode (mirrors
    // setQfitModel), and swaps between the ROI-band interaction and the
    // cursors interaction (they're mutually exclusive — only one is armed).
    setGadgetMode: (mode) => {
      const prev = get().gadgetMode;
      if (prev === mode) return;
      set({ gadgetMode: mode });
      if (mode === "cursors") {
        if (get().qfitRoi) get().setQfitRoi(null);
        return;
      }
      if (prev === "cursors" && get().gadgetCursors) get().setGadgetCursors(null);
      if (get().qfitRoi) get().setQfitRoi(get().qfitRoi);
    },
    runGadget: async () => {
      switch (get().gadgetMode) {
        case "fit":
          return get().runQuickFit();
        case "integrate":
          return get().runGadgetIntegrate();
        case "stats":
          return get().runGadgetStats();
        case "differentiate":
          return get().runGadgetDifferentiate();
        case "fft":
          return get().runGadgetFft();
        case "cursors":
          return; // cursors don't ride the ROI-band debounce path
      }
    },
    runGadgetIntegrate: async () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return;
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, s.qfitRoi, col);
      if (sel.x.length < 2) {
        set({ gadgetError: "not enough points in the selected region", gadgetBusy: false, gadgetIntegrateResult: null });
        return;
      }
      const lo = Math.min(s.qfitRoi[0], s.qfitRoi[1]);
      const hi = Math.max(s.qfitRoi[0], s.qfitRoi[1]);
      set({ gadgetBusy: true, gadgetError: null });
      try {
        const r = await peaksIntegrate({ x: sel.x, y: sel.y, regions: [[lo, hi]], baseline: "linear" });
        const cur = get();
        if (cur.activeId !== active.id || !cur.qfitRoi) return;
        set({ gadgetIntegrateResult: r, gadgetBusy: false });
      } catch (e) {
        set({ gadgetBusy: false, gadgetError: e instanceof Error ? e.message : "integrate failed" });
      }
    },
    runGadgetStats: async () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitRoi) return;
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, s.qfitRoi, col);
      if (sel.y.length < 1) {
        set({ gadgetError: "not enough points in the selected region", gadgetBusy: false, gadgetStatsResult: null });
        return;
      }
      set({ gadgetBusy: true, gadgetError: null });
      try {
        const r = await statsDescriptive(sel.y);
        const cur = get();
        if (cur.activeId !== active.id || !cur.qfitRoi) return;
        set({ gadgetStatsResult: r, gadgetBusy: false });
      } catch (e) {
        set({ gadgetBusy: false, gadgetError: e instanceof Error ? e.message : "stats failed" });
      }
    },
    // Synchronous (client-side central differences) — no busy state, but shares
    // `gadgetError` with the async modes for a consistent chip error slot.
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
      if (!active || !s.qfitRoi) return;
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
      set({ gadgetBusy: true, gadgetError: null });
      try {
        const r = await fftSpectral({ x: sorted.x, y: sorted.y });
        const cur = get();
        if (cur.activeId !== active.id || !cur.qfitRoi) return;
        set({ gadgetFftPreview: r, gadgetBusy: false });
      } catch (e) {
        set({ gadgetBusy: false, gadgetError: e instanceof Error ? e.message : "FFT failed" });
      }
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
      const magRaw = (r.magnitude ?? r.psd ?? r.phase) as (number | null)[] | undefined;
      const mag = Array.isArray(magRaw) ? magRaw : [];
      const label = r.magnitude ? "magnitude" : r.psd ? "psd" : "phase";
      const data: DataStruct = {
        time: freq,
        values: mag.map((v) => [v ?? Number.NaN]),
        labels: [label],
        units: [""],
        metadata: { source: "fft gadget", sourceDataset: active.name, window: r.windowName },
      };
      get().addDataset({ id: nextDatasetId(), name: `${active.name} — FFT`, data });
      get().setStatus("FFT spectrum added to library");
      toast("FFT spectrum added to library", "ok");
    },
    // Paired-cursors mode: recomputed synchronously on every placement/drag
    // (cheap nearest-sample math, not an API call) against the FULL first
    // plotted channel — cursors aren't ROI-scoped.
    setGadgetCursors: (gadgetCursors) => {
      set({ gadgetCursors });
      if (!gadgetCursors) {
        set({ gadgetCursorResult: null });
        return;
      }
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active) {
        set({ gadgetCursorResult: null });
        return;
      }
      const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
      const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
      const sel = selectRoiRows(active, [-Infinity, Infinity], col);
      set({ gadgetCursorResult: computeCursorReadout(sel.x, sel.y, gadgetCursors) });
    },
    clearQfit: () => {
      get().setQfitRoi(null);
      get().setGadgetCursors(null);
    },
  };
}
