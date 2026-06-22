// Curve Fit workshop — state hook (the React analogue of the MATLAB workshop
// pattern). Owns model selection + fit result; calls /api/fitting and pushes
// the fitted curve into the store as a plot overlay. The view stays thin.

import { useEffect, useMemo, useState } from "react";

import { autoGuess, fitModel, listFitModels } from "../../../lib/api";
import type { CalcResult, Dataset, FitModel } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface CurveFitState {
  active: Dataset | null;
  models: FitModel[];
  modelName: string;
  setModelName: (name: string) => void;
  result: CalcResult | null;
  guessOnly: boolean;
  busy: boolean;
  error: string | null;
  run: (kind: "guess" | "fit") => Promise<void>;
  clear: () => void;
}

export function useCurveFit(): CurveFitState {
  const active = useActiveDataset();
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const [models, setModels] = useState<FitModel[]>([]);
  const [modelName, setModelName] = useState("Linear");
  const [result, setResult] = useState<CalcResult | null>(null);
  const [guessOnly, setGuessOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFitModels()
      .then((r) => {
        if (!cancelled) setModels(r.models);
      })
      .catch(() => {
        /* offline — model list stays empty; Fit still posts and surfaces errors */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fit the first value channel against the dataset's x (= DataStruct.time,
  // the same x the plot uses), so the fit curve overlays in register.
  const xy = useMemo(() => {
    if (!active) return null;
    return { x: active.data.time, y: active.data.values.map((row) => row[0]) };
  }, [active]);

  async function run(kind: "guess" | "fit"): Promise<void> {
    if (!active || !xy) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "guess") {
        const g = await autoGuess(modelName, xy.x, xy.y);
        setResult({ params: g.p0 });
        setGuessOnly(true);
      } else {
        const r = await fitModel({ model: modelName, x: xy.x, y: xy.y });
        setResult(r);
        setGuessOnly(false);
        const yFit = r.yFit as (number | null)[] | undefined;
        if (Array.isArray(yFit)) setFitOverlay({ datasetId: active.id, y: yFit });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "fit failed");
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    setResult(null);
    setGuessOnly(false);
    setError(null);
    setFitOverlay(null);
  }

  return {
    active,
    models,
    modelName,
    setModelName,
    result,
    guessOnly,
    busy,
    error,
    run,
    clear,
  };
}
