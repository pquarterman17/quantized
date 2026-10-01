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

import type { FftSpectralResult, IntegrateResponse } from "../lib/api";
import type { DerivativeResult } from "../lib/differentiate";
import { fitStepParams } from "../lib/fitselection";
import { computeCursorReadout } from "../lib/gadgetCursors";
import { lit } from "../lib/macro";
import type { Measurement } from "../lib/measure";
import type { RegionContext } from "../lib/plotRangeSelection";
import { effectiveChannels } from "../lib/plotdata";
import {
  firstVisiblePlottedChannel,
  qfitSpec,
  selectRoiRows,
  type GadgetMode,
} from "../lib/quickfit";
import type { CalcResult, DataStruct, FitOverlay } from "../lib/types";
import { toast } from "./toasts";
import { nextDatasetId } from "./idSeq";
import type { GadgetRunCtx, GadgetRunner } from "./gadgetRun";
import type { AppState } from "./useApp";

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
  /** The dataset + X column `qfitRoi` was drawn on (lib/plotRangeSelection). */
  qfitRoiFor: RegionContext | null;
  qfitModel: string;
  qfitBusy: boolean;
  qfitResult: CalcResult | null;
  /** The model that PRODUCED `qfitResult` — what commit/report must name. */
  qfitResultModel: string | null;
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
  runGadgetDifferentiate: () => Promise<void>;
  runGadgetFft: () => Promise<void>;
  commitGadgetFft: () => void;
  setGadgetCursors: (cursors: [number, number] | null) => void;
  clearQfit: () => void;
}

/** The modes whose compute is an async request (busy through the debounce). */
const ASYNC_GADGET_MODES: ReadonlySet<GadgetMode> = new Set(["integrate", "stats", "fft"]);

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createGadgetSlice(set: SliceSet, get: SliceGet): GadgetSlice {
  // Quick-fit gadget internals (#33): a module-level debounce timer, mirroring
  // the recalc scheduler in useApp.ts — a burst of ROI-drag moves triggers ONE fit.
  let qfitTimer: ReturnType<typeof setTimeout> | null = null;
  // Region-request sequence (fit AND the async gadget modes): bumped by every
  // ROI/model/mode change and every request, so only the LATEST request's
  // response may land (a slow earlier one can't).
  let qfitSeq = 0;
  // Drop the current fit result — and the overlay only if this gadget drew it.
  const dropQfitResult = (s: AppState): Partial<AppState> => ({
    qfitResult: null,
    qfitResultModel: null,
    fitOverlay: s.qfitResult != null ? null : s.fitOverlay,
  });

  // The compute bodies (store/gadgetRun.ts) load on the first ROI compute
  // (bundle diet slice 19). A failed load is not cached, so the next compute
  // fetches again. It lands in the mode's own error slot, like a failed
  // request, unless the region moved on while it loaded.
  let runner: GadgetRunner | null = null;
  const runCtx: GadgetRunCtx = { set, get, nextSeq: () => ++qfitSeq, seq: () => qfitSeq, dropQfitResult };
  const viaRun = (call: (r: GadgetRunner) => Promise<void> | void, slot: "fit" | "gadget" | "deriv") =>
    async (): Promise<void> => {
      const seq = qfitSeq;
      try {
        runner ??= (await import("./gadgetRun")).createGadgetRun(runCtx);
      } catch (e) {
        if (seq !== qfitSeq || !get().qfitRoi) return;
        const msg = `ROI gadget failed to load: ${e instanceof Error ? e.message : "error"}`;
        if (slot === "fit") set((cur) => ({ ...dropQfitResult(cur), qfitBusy: false, qfitError: msg }));
        else if (slot === "deriv") set({ gadgetError: msg, gadgetDerivResult: null, derivOverlay: null });
        else set({ gadgetBusy: false, gadgetError: msg });
        return;
      }
      await call(runner);
    };

  return {
    qfitRoi: null,
    qfitRoiFor: null,
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: null,
    qfitResultModel: null,
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
      // Stamp WHICH dataset + X column the band was drawn on (a re-set of the
      // same band keeps its stamp), so "Fit this range" can refuse a stale one.
      // Any ROI (or, via setQfitModel, model) change invalidates the fit
      // result and every in-flight request for the old range/model.
      qfitSeq += 1;
      set((s) => ({
        qfitRoi: roi,
        qfitRoiFor: roi === null ? null
          : roi === s.qfitRoi && s.qfitRoiFor ? s.qfitRoiFor : { datasetId: s.activeId, xKey: s.xKey },
        ...dropQfitResult(s),
        // The old region's numbers must never show (or report/commit) under the
        // new region's caption: drop them, and stay busy through the debounce.
        gadgetIntegrateResult: null,
        gadgetStatsResult: null,
        gadgetFftPreview: null,
        gadgetError: null,
        gadgetBusy: roi !== null && ASYNC_GADGET_MODES.has(s.gadgetMode),
      }));
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
          qfitBusy: false,
          qfitError: null,
          gadgetDerivResult: null,
          derivOverlay: s.gadgetDerivResult != null ? null : s.derivOverlay,
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
    runQuickFit: viaRun((r) => r.runQuickFit(), "fit"),
    commitQfit: () => {
      const s = get();
      const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
      if (!active || !s.qfitResult) return;
      // Durable fit spec (audit P1 #3): records the plotted channels the gadget
      // fit (first visible plotted channel + xKey), reused as the step params so
      // a template batch replays those channels, not time/values[0]. The ROI only
      // shaped which rows the user previewed (preview-only — never encoded).
      // The model that PRODUCED the result, never the picker's current value.
      const model = s.qfitResultModel ?? s.qfitModel;
      const spec = qfitSpec(active, s, model, s.qfitResult);
      get().recordMacro(`Fit ${model}`, `qz.fit(${lit(model)})`, {
        kind: "fit",
        params: fitStepParams(model, spec),
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
    // The five region computes live in store/gadgetRun.ts (bundle diet slice
    // 19) and load on the first compute of a session; see `viaRun` above.
    runGadgetIntegrate: viaRun((r) => r.runGadgetIntegrate(), "gadget"),
    runGadgetStats: viaRun((r) => r.runGadgetStats(), "gadget"),
    runGadgetDifferentiate: viaRun((r) => r.runGadgetDifferentiate(), "deriv"),
    runGadgetFft: viaRun((r) => r.runGadgetFft(), "gadget"),
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
