// ROI gadget family chip state hook (gap #33 fit → #34 the rest). The live
// ROI-drag/cursors-drag → debounced-compute → overlay wiring lives in the
// store (setQfitRoi/setGadgetCursors/runGadget* — see useApp.ts) so it's
// reachable straight from the uPlot plugins' callbacks without a React
// round-trip; this hook owns only what the CHIP itself needs: the mode
// picker, each mode's live result for display, the fit model picker, the
// mode-aware "Commit" ending (fit → durable fitSpec; fft → a new library
// dataset; other modes have no commit action), and the "→ Report" ending
// for the modes with a natural report emitter (fit/integrate/stats —
// mirrors the Curve Fit workshop's own toReport, lib/report #36).
//
// GUI_INTERACTION #9 (universal Esc-cancel): dismissing the ARMED-BUT-IDLE
// gadget (a committed roi/cursors sitting with no drag in progress) on
// Escape now lives in the ONE centralized handler (useGlobalShortcuts),
// alongside every other plot-tool's Esc semantics — not a bespoke listener
// here. Reasoning: `roi`/`cursors` change on every mousemove tick of a live
// drag (setQfitRoi/setGadgetCursors fire continuously), so a listener keyed
// off them (as this hook used to have) tears down and re-registers dozens
// of times a second while dragging, racing the drag's OWN gesture-cancel
// registration (lib/gestureCancel) for which one wins a given Escape press.
// The centralized handler calls `cancelActiveGesture()` first (so a live
// drag is aborted in place, keeping whatever was committed before it
// started) and only falls back to this hook's `dismiss` (still exported,
// unchanged) when nothing was mid-drag.

import { useState } from "react";

import { reportEmit, type FftSpectralResult, type IntegrateResponse } from "../../lib/api";
import type { DerivativeResult } from "../../lib/differentiate";
import { fmtNum } from "../../lib/format";
import type { Measurement } from "../../lib/measure";
import { GADGET_MODES, QUICK_FIT_MODELS, type GadgetMode } from "../../lib/quickfit";
import type { CalcResult } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { toast } from "../../store/toasts";

export interface GadgetChipState {
  mode: GadgetMode;
  modes: readonly GadgetMode[];
  setMode: (mode: GadgetMode) => void;
  // Region-based modes (fit/integrate/stats/differentiate/fft) share one ROI.
  roi: [number, number] | null;
  // Cursors mode uses two independent positions instead.
  cursors: [number, number] | null;
  // fit
  model: string;
  models: readonly string[];
  setModel: (model: string) => void;
  fitResult: CalcResult | null;
  // integrate
  integrateResult: IntegrateResponse | null;
  // stats
  statsResult: CalcResult | null;
  // differentiate
  derivResult: DerivativeResult | null;
  // fft
  fftPreview: FftSpectralResult | null;
  // cursors
  cursorResult: Measurement | null;
  // shared
  busy: boolean;
  error: string | null;
  reporting: boolean;
  /** fit → writes the durable fitSpec; fft → adds the preview as a new
   *  library dataset; every other mode has nothing to commit (disabled). */
  commit: () => void;
  /** Available for fit/integrate/stats — the modes with a natural report
   *  emitter; a no-op for differentiate/fft/cursors. */
  report: () => Promise<void>;
  dismiss: () => void;
}

export function useGadgetChip(): GadgetChipState {
  const active = useActiveDataset();
  const mode = useApp((s) => s.gadgetMode);
  const setMode = useApp((s) => s.setGadgetMode);
  const roi = useApp((s) => s.qfitRoi);
  const cursors = useApp((s) => s.gadgetCursors);
  const model = useApp((s) => s.qfitModel);
  const setModel = useApp((s) => s.setQfitModel);
  const fitResult = useApp((s) => s.qfitResult);
  const qfitBusy = useApp((s) => s.qfitBusy);
  const qfitError = useApp((s) => s.qfitError);
  const integrateResult = useApp((s) => s.gadgetIntegrateResult);
  const statsResult = useApp((s) => s.gadgetStatsResult);
  const derivResult = useApp((s) => s.gadgetDerivResult);
  const fftPreview = useApp((s) => s.gadgetFftPreview);
  const cursorResult = useApp((s) => s.gadgetCursorResult);
  const gadgetBusy = useApp((s) => s.gadgetBusy);
  const gadgetError = useApp((s) => s.gadgetError);
  const commitQfit = useApp((s) => s.commitQfit);
  const commitGadgetFft = useApp((s) => s.commitGadgetFft);
  const dismiss = useApp((s) => s.clearQfit);
  const [reporting, setReporting] = useState(false);

  const busy = mode === "fit" ? qfitBusy : gadgetBusy;
  const error = mode === "fit" ? qfitError : gadgetError;

  function commit(): void {
    if (mode === "fit") commitQfit();
    else if (mode === "fft") commitGadgetFft();
    // integrate/stats/differentiate/cursors: nothing durable to commit.
  }

  async function report(): Promise<void> {
    if (!active || !roi) return;
    setReporting(true);
    try {
      if (mode === "fit" && fitResult) {
        const params = (fitResult.params as number[] | undefined) ?? [];
        const { report: sheet } = await reportEmit({
          kind: "curve_fit",
          result: fitResult as Record<string, unknown>,
          param_names: params.map((_, i) => `p${i}`),
          model_name: model,
          title: `${model} quick-fit — ${active.name}`,
          caption: `region ${fmtNum(Math.min(roi[0], roi[1]))}–${fmtNum(Math.max(roi[0], roi[1]))}`,
          source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
        });
        useApp.getState().addReport(`${model} quick-fit — ${active.name}`, sheet, active.id);
      } else if (mode === "integrate" && integrateResult) {
        const { report: sheet } = await reportEmit({
          kind: "integrate",
          result: integrateResult as unknown as Record<string, unknown>,
          title: `Integrate — ${active.name}`,
          caption: `region ${fmtNum(Math.min(roi[0], roi[1]))}–${fmtNum(Math.max(roi[0], roi[1]))}`,
          source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
        });
        useApp.getState().addReport(`Integrate — ${active.name}`, sheet, active.id);
      } else if (mode === "stats" && statsResult) {
        const { report: sheet } = await reportEmit({
          kind: "stats_table",
          records: [statsResult as Record<string, unknown>],
          columns: ["N", "mean", "std", "min", "max"],
          title: `Stats — ${active.name}`,
          caption: `region ${fmtNum(Math.min(roi[0], roi[1]))}–${fmtNum(Math.max(roi[0], roi[1]))}`,
          source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
        });
        useApp.getState().addReport(`Stats — ${active.name}`, sheet, active.id);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setReporting(false);
    }
  }

  return {
    mode,
    modes: GADGET_MODES,
    setMode,
    roi,
    cursors,
    model,
    models: QUICK_FIT_MODELS,
    setModel,
    fitResult,
    integrateResult,
    statsResult,
    derivResult,
    fftPreview,
    cursorResult,
    busy,
    error,
    reporting,
    commit,
    report,
    dismiss,
  };
}
