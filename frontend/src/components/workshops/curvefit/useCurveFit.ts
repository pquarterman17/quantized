// Curve Fit workshop — state hook (the React analogue of the MATLAB workshop
// pattern). Owns model selection + fit result; calls /api/fitting and pushes
// the fitted curve into the store as a plot overlay. The view stays thin.

import { useEffect, useMemo, useState } from "react";

import { autoGuess, fitModel, listFitModels } from "../../../lib/api";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
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

  // Fit the analysis view (excluded/filtered rows dropped, #50/#53) so the fit
  // ignores them — the same rows the plot hides/greys. The overlay is then
  // expanded back to full length so it overlays the full-length plot x in register.
  const xy = useMemo(() => {
    const d = analysisData(active);
    if (!d) return null;
    return { x: d.time, y: d.values.map((row) => row[0]) };
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
        if (Array.isArray(yFit)) {
          // yFit aligns to the pruned analysis x; expand it back to the full row
          // count (null at dropped rows) so it stays in register with the
          // full-length plot x, whether excluded rows are hidden or greyed.
          const n = active.data.time.length;
          const kept = activeRowIndices(n, droppedRows(active));
          const y = kept.length === n ? yFit : expandToFull(yFit, kept, n);
          setFitOverlay({ datasetId: active.id, y });
        }
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
