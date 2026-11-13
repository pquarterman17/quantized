// Curve Fit — the panel's side of fit templates (moved out of
// CurveFitPanel.tsx at the component ceiling): the settings a "Save as
// template" captures from the panel as it is now, and how a chosen template is
// loaded back into it. Applying only LOADS settings; the user presses Fit.

import { autoStartRows, type FitParamRow } from "../../../lib/fitParams";
import type { FitTemplateSettings } from "../../../lib/fitTemplates";
import type { Dataset, FitModel, WeightMode } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { toast } from "../../../store/toasts";

interface PanelSettings {
  active: Dataset | null;
  models: readonly FitModel[];
  modelName: string;
  setModelName: (name: string) => void;
  weightMode: WeightMode;
  setWeightMode: (mode: WeightMode) => void;
  manualKey: number | null;
  setManualKey: (key: number | null) => void;
  scaleErrors: boolean;
  setScaleErrors: (on: boolean) => void;
  paramRows: FitParamRow[];
  replaceParamRows: (rows: FitParamRow[]) => void;
}

export interface FitTemplateBinding {
  /** The settings to save, as the panel holds them now. */
  current: FitTemplateSettings;
  /** Load a template into the panel; false when it cannot apply here. */
  apply: (t: FitTemplateSettings) => boolean;
}

export function useFitTemplateBinding(p: PanelSettings): FitTemplateBinding {
  const updateAnalysisItem = useAnalysisSelection((state) => state.updateItem);
  const selectionRange = useAnalysisSelection((state) =>
    state.toolId === "curvefit" ? (state.selection?.items[0]?.range ?? null) : null,
  );
  const { active } = p;
  const auto = new Set(autoStartRows(p.paramRows, p.models.find((m) => m.name === p.modelName)));
  const current: FitTemplateSettings = {
    version: 1,
    model: p.modelName,
    weight: p.weightMode,
    ...((p.weightMode === "manual" || p.weightMode === "direct") && p.manualKey != null && active
      ? { manualLabel: active.data.labels[p.manualKey] ?? "" }
      : {}),
    ...(p.weightMode !== "none" && !p.scaleErrors ? { scaleErrors: false as const } : {}),
    // A start the user did not choose is saved BLANK (auto): applied in the
    // panel or replayed as a pipeline step it is guessed from THAT data, not
    // frozen at this model's seeded default.
    rows: p.paramRows.map((r, i) => (auto.has(i) ? { ...r, start: "" } : r)),
    ...(selectionRange ? { range: { lo: selectionRange.lo, hi: selectionRange.hi } } : {}),
  };
  const apply = (t: FitTemplateSettings): boolean => {
    if (!p.models.some((m) => m.name === t.model)) {
      toast(`fit template needs the model "${t.model}", which this build does not have`, "danger");
      return false;
    }
    p.setModelName(t.model);
    p.setWeightMode(t.weight);
    p.setScaleErrors(t.scaleErrors !== false);
    const manual = t.manualLabel !== undefined && active ? active.data.labels.indexOf(t.manualLabel) : -1;
    p.setManualKey(manual >= 0 ? manual : null);
    p.replaceParamRows(t.rows);
    if (active) updateAnalysisItem(active.id, { range: t.range ? { ...t.range, source: "manual" } : null });
    return true;
  };
  return { current, apply };
}
