// Curve Fit — "Compare models" state hook. Fits every picked model (registry
// names, or saved custom equations as "custom:<name>") to the SAME selection
// the Fit button uses (plotted X / primary Y over the analysis rows, gap rows
// dropped) via POST /api/fitting/compare (calc.fit_model_compare), unweighted,
// and keeps the comparison table: fit_compare metrics, ΔAIC/ΔAICc/ΔBIC vs
// the best candidate, and the nested F-test vs the simplest candidate.

import { useState } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { compareModels, type CompareResult } from "../../../lib/api/fitStats";
import { candidateGuesses, type CustomFitModel } from "../../../lib/fitmodels";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";
import { afterCommit } from "../workbench/afterCommit";
import { Refusal } from "../workbench/refusal";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";

/** Picker values of saved custom equation models carry this prefix. */
export const CUSTOM_PREFIX = "custom:";

export interface CompareModelsState {
  picked: string[];
  add: (value: string) => void;
  remove: (value: string) => void;
  canCompare: boolean;
  busy: boolean;
  error: string | null;
  /** `error` is a refusal (nothing to compare on), not a failed request. */
  refusal: boolean;
  /** The shown table was compared under picks, equations or data that have since changed. */
  stale: boolean;
  result: CompareResult | null;
  compare: () => Promise<void>;
}

export function useCompareModels(initial: string[], customModels: readonly CustomFitModel[]): CompareModelsState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [picked, setPicked] = useState<string[]>(() => initial.filter((v) => v && v !== CUSTOM_PREFIX));

  // Rides the workbench shell in MANUAL mode: nothing runs on an edit, only the
  // Compare button. The key is the picks, the saved equations behind them, the
  // dataset's row / data identity and the plotted channels: a table whose key
  // differs is out of date, and an answer for inputs changed in flight is dropped.
  const customPicked = picked.filter((v) => v.startsWith(CUSTOM_PREFIX)).map((v) => customModels.find((m) => m.name === v.slice(CUSTOM_PREFIX.length)) ?? null);
  const key = active ? JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, picked, customPicked]) : "";
  const preview = useWorkbenchPreview<CompareResult | null>({
    key,
    auto: false,
    delayMs: 0,
    fallbackError: "compare failed",
    run: async (signal) => {
      if (!active) return null;
      const ds = await resolveDataset(active.id);
      const d = ds ? selectedFitData(ds, xKey, yKeys, seriesOrder) : null;
      if (!d) throw new Refusal(fitSelectionRefusal(ds, xKey, yKeys, seriesOrder) ?? "select a dataset to compare models on");
      const pairs = dropGapRows(d.x, d.y);
      const models = picked.filter((v) => !v.startsWith(CUSTOM_PREFIX));
      const equations = customPicked
        .filter((m): m is CustomFitModel => m != null)
        .map((m) => ({ name: m.name, equation: m.equation, ...candidateGuesses(m) }));
      return await compareModels({ x: pairs.x, y: pairs.y, models, equations }, signal);
    },
  });

  async function compare(): Promise<void> {
    if (!active || picked.length < 2) return;
    // Resolve a lazy book first: its arrival moves the key, which would abort a run launched before it.
    if (active.pending) {
      await resolveDataset(active.id);
      await afterCommit();
    }
    return preview.refresh();
  }

  // A failed run shows its error and no table, as before.
  const error = preview.error || null;
  const shown = error ? null : preview.latest?.value ?? null;

  return {
    picked,
    add: (value) => {
      if (value && value !== CUSTOM_PREFIX) setPicked((p) => (p.includes(value) ? p : [...p, value]));
    },
    remove: (value) => setPicked((p) => p.filter((v) => v !== value)),
    canCompare: active != null && picked.length >= 2 && !preview.running,
    busy: preview.running,
    error,
    refusal: error !== null && preview.refusal,
    stale: shown !== null && preview.stale,
    result: shown,
    compare,
  };
}
