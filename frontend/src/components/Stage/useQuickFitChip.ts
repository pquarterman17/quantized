// Quick-fit gadget (#33) chip state hook. The live ROI-drag → debounced-fit →
// fitOverlay wiring lives in the store (setQfitRoi/runQuickFit — see useApp.ts)
// so it's reachable straight from the uPlot plugin's onRoiChange callback
// without a React round-trip; this hook owns only what the CHIP itself needs:
// the model picker, the explicit "Commit" action (durable fitSpec — never
// auto-committed), and the optional "→ Report" emission (mirrors the Curve
// Fit workshop's own toReport, lib/report #36).

import { useEffect, useState } from "react";

import { reportEmit } from "../../lib/api";
import { fmtNum } from "../../lib/format";
import { QUICK_FIT_MODELS } from "../../lib/quickfit";
import type { CalcResult } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { toast } from "../../store/toasts";

export interface QuickFitChipState {
  roi: [number, number] | null;
  model: string;
  models: readonly string[];
  busy: boolean;
  error: string | null;
  result: CalcResult | null;
  reporting: boolean;
  setModel: (model: string) => void;
  commit: () => void;
  report: () => Promise<void>;
  dismiss: () => void;
}

export function useQuickFitChip(): QuickFitChipState {
  const active = useActiveDataset();
  const roi = useApp((s) => s.qfitRoi);
  const model = useApp((s) => s.qfitModel);
  const busy = useApp((s) => s.qfitBusy);
  const error = useApp((s) => s.qfitError);
  const result = useApp((s) => s.qfitResult);
  const setModel = useApp((s) => s.setQfitModel);
  const commit = useApp((s) => s.commitQfit);
  const dismiss = useApp((s) => s.clearQfit);
  const [reporting, setReporting] = useState(false);

  // Escape clears the gadget (roi + chip + overlay) while it's armed — the
  // other trigger, a tool switch, is handled by PlotStage's own tool effect.
  useEffect(() => {
    if (!roi) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roi, dismiss]);

  async function report(): Promise<void> {
    if (!result || !active || !roi) return;
    setReporting(true);
    try {
      const params = (result.params as number[] | undefined) ?? [];
      const { report: sheet } = await reportEmit({
        kind: "curve_fit",
        result: result as Record<string, unknown>,
        param_names: params.map((_, i) => `p${i}`),
        model_name: model,
        title: `${model} quick-fit — ${active.name}`,
        caption: `region ${fmtNum(Math.min(roi[0], roi[1]))}–${fmtNum(Math.max(roi[0], roi[1]))}`,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      useApp.getState().addReport(`${model} quick-fit — ${active.name}`, sheet, active.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setReporting(false);
    }
  }

  return { roi, model, models: QUICK_FIT_MODELS, busy, error, result, reporting, setModel, commit, report, dismiss };
}
