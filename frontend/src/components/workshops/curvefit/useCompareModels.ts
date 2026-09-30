// Curve Fit — "Compare models" state hook. Fits every picked model (registry
// names, or saved custom equations as "custom:<name>") to the SAME selection
// the Fit button uses (plotted X / primary Y over the analysis rows, gap rows
// dropped) via POST /api/fitting/compare (calc.fit_model_compare), unweighted,
// and keeps the comparison table: fit_compare metrics, ΔAIC/ΔAICc/ΔBIC vs
// the best candidate, and the nested F-test vs the simplest candidate.

import { useState } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { compareModels, type CompareResult } from "../../../lib/api/fitStats";
import type { CustomFitModel } from "../../../lib/fitmodels";
import { selectedFitData } from "../../../lib/fitselection";
import { useActiveDataset, useApp } from "../../../store/useApp";

/** Picker values of saved custom equation models carry this prefix. */
export const CUSTOM_PREFIX = "custom:";

export interface CompareModelsState {
  picked: string[];
  add: (value: string) => void;
  remove: (value: string) => void;
  canCompare: boolean;
  busy: boolean;
  error: string | null;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);

  async function compare(): Promise<void> {
    if (!active || picked.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const ds = await resolveDataset(active.id);
      const d = ds ? selectedFitData(ds, xKey, yKeys, seriesOrder) : null;
      if (!d) throw new Error("select a dataset to compare models on");
      const pairs = dropGapRows(d.x, d.y);
      const models = picked.filter((v) => !v.startsWith(CUSTOM_PREFIX));
      const equations = picked
        .filter((v) => v.startsWith(CUSTOM_PREFIX))
        .map((v) => customModels.find((m) => m.name === v.slice(CUSTOM_PREFIX.length)))
        .filter((m): m is CustomFitModel => m != null)
        .map((m) => ({ name: m.name, equation: m.equation, guesses: m.guesses }));
      setResult(await compareModels({ x: pairs.x, y: pairs.y, models, equations }));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "compare failed");
    } finally {
      setBusy(false);
    }
  }

  return {
    picked,
    add: (value) => {
      if (value && value !== CUSTOM_PREFIX) setPicked((p) => (p.includes(value) ? p : [...p, value]));
    },
    remove: (value) => setPicked((p) => p.filter((v) => v !== value)),
    canCompare: active != null && picked.length >= 2 && !busy,
    busy,
    error,
    result,
    compare,
  };
}
