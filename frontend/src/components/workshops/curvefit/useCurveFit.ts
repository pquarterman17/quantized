// Curve Fit workshop — state hook (the React analogue of the MATLAB workshop
// pattern). Owns model selection + fit result; calls /api/fitting and pushes
// the fitted curve into the store as a plot overlay. The view stays thin.

import { useEffect, useMemo, useState } from "react";

import { autoGuess, bootstrapFit, exportCornerFigure, fitModel, listFitModels } from "../../../lib/api";
import { activeRowIndices, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { CalcResult, Dataset, FitModel, FitWeighting, WeightMode } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { fitSpecFrom, selectedFitData } from "../../../lib/fitselection";
import { dyForFit } from "../../../lib/fitweights";

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
  /** Bootstraps the current fit (return_samples: true) then exports a
   *  pairwise corner (pairs) plot of the parameter uncertainty — gap #29's
   *  remaining UI leg. Requires a completed (non-guess) fit result. */
  runCornerPlot: () => Promise<void>;
  cornerBusy: boolean;
  /** [min, max] of the fitted x data — the domain Find X/Y (MAIN #15)
   *  searches over; null when there's no analysis data yet. */
  xRange: { min: number; max: number } | null;
  /** Weighting (Sol audit): mode selector + a picked sigma column for `manual`. */
  weightMode: WeightMode;
  setWeightMode: (m: WeightMode) => void;
  manualKey: number | null;
  setManualKey: (k: number | null) => void;
  /** True when the primary fit channel has a designated error column (enables
   *  the "Y error column" mode). */
  hasYErr: boolean;
  /** Non-fatal weighting note (e.g. missing/invalid error column → fit ran
   *  unweighted); null when weighting resolved cleanly. */
  weightNote: string | null;
}

export function useCurveFit(): CurveFitState {
  const active = useActiveDataset();
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const errKeys = useApp((s) => s.errKeys);
  const [models, setModels] = useState<FitModel[]>([]);
  const [modelName, setModelName] = useState("Linear");
  const [result, setResult] = useState<CalcResult | null>(null);
  const [guessOnly, setGuessOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cornerBusy, setCornerBusy] = useState(false);
  const [weightMode, setWeightMode] = useState<WeightMode>("none");
  const [manualKey, setManualKey] = useState<number | null>(null);
  const [weightNote, setWeightNote] = useState<string | null>(null);

  /** The weighting choice for a given primary channel: `yerr` resolves its
   *  sigma column from the view's `errKeys`; `manual` uses the picked column. */
  function weightingFor(yKey: number): FitWeighting {
    if (weightMode === "yerr") return { mode: "yerr", errKey: errKeys[yKey] };
    if (weightMode === "manual")
      return manualKey != null ? { mode: "manual", errKey: manualKey } : { mode: "manual" };
    return { mode: weightMode };
  }

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
    return selectedFitData(active, xKey, yKeys, seriesOrder);
  }, [active, seriesOrder, xKey, yKeys]);

  const xRange = useMemo(() => {
    if (!xy) return null;
    const finite = xy.x.filter((v) => Number.isFinite(v));
    if (finite.length === 0) return null;
    return { min: Math.min(...finite), max: Math.max(...finite) };
  }, [xy]);

  // The "Y error column" mode is only meaningful when the primary fit channel
  // has a designated error column (from Origin designations or manual pairing).
  const hasYErr = xy != null && errKeys[xy.yKey] != null;

  async function run(kind: "guess" | "fit"): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: never guess/fit against the small preview —
      // resolve the active dataset's full data first (no-op if it isn't
      // pending). Re-derive x/y from the RESOLVED dataset, not the possibly
      // stale `xy` memo captured before the await.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      // Read selection again after the await: the user may have changed the
      // plotted channels while a lazy Origin book was resolving.
      const state = useApp.getState();
      const localXy = selectedFitData(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (!localXy) return;
      if (kind === "guess") {
        const g = await autoGuess(modelName, localXy.x, localXy.y);
        setResult({ params: g.p0 });
        setGuessOnly(true);
      } else {
        // Resolve weighting -> dy over the SAME analysis rows as the fit; a
        // missing/invalid error column refits unweighted with a surfaced note.
        const weight = weightingFor(localXy.yKey);
        const { dy, issue } = dyForFit(ds, localXy.yKey, weight);
        setWeightNote(issue ?? null);
        const r = await fitModel({
          model: modelName,
          x: localXy.x,
          y: localXy.y,
          ...(dy ? { dy } : {}),
        });
        setResult(r);
        setGuessOnly(false);
        // Recorded as a typed step so the pipeline view (#6) can edit the
        // model and re-run the fit.
        useApp.getState().recordMacro(`Fit ${modelName}`, `qz.fit("${modelName}")`, {
          kind: "fit",
          params: { model: modelName },
        });
        // Durable fit spec (audit P1 #3): records the plotted channels + the
        // weighting ACTUALLY used (unweighted if dy couldn't resolve) so the
        // recalc graph (#1) reproduces the original fit, not time/values[0].
        const effWeight: FitWeighting = dy ? weight : { mode: "none" };
        useApp
          .getState()
          .setFitSpec(ds.id, fitSpecFrom(modelName, state.xKey, localXy, r, effWeight));
        const yFit = r.yFit as (number | null)[] | undefined;
        if (Array.isArray(yFit)) {
          // yFit aligns to the pruned analysis x; expand it back to the full row
          // count (null at dropped rows) so it stays in register with the
          // full-length plot x, whether excluded rows are hidden or greyed.
          const n = ds.data.time.length;
          const kept = activeRowIndices(n, droppedRows(ds));
          const y = kept.length === n ? yFit : expandToFull(yFit, kept, n);
          setFitOverlay({ datasetId: ds.id, y });
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
    setWeightNote(null);
    setFitOverlay(null);
    if (active) useApp.getState().setFitSpec(active.id, null);
  }

  async function runCornerPlot(): Promise<void> {
    if (!active || !xy || !result || guessOnly) return;
    const p0 = (result.params as number[] | undefined) ?? [];
    if (p0.length === 0) return;
    setCornerBusy(true);
    setError(null);
    try {
      const boot = await bootstrapFit({
        model: modelName,
        x: xy.x,
        y: xy.y,
        p0,
        return_samples: true,
      });
      if (!boot.boot_samples || boot.boot_samples.length === 0) {
        throw new Error("bootstrap returned no replicate samples");
      }
      const names = models.find((m) => m.name === modelName)?.paramNames ?? [];
      const paramNames =
        names.length === boot.params.length ? names : boot.params.map((_, i) => `p${i}`);
      const stem = active.name.replace(/\.[^.]+$/, "");
      await exportCornerFigure({
        samples: boot.boot_samples,
        param_names: paramNames,
        truths: boot.params,
        title: `${modelName} corner — ${active.name}`,
        filename: `${stem}-corner`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "corner plot failed");
    } finally {
      setCornerBusy(false);
    }
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
    runCornerPlot,
    cornerBusy,
    xRange,
    weightMode,
    setWeightMode,
    manualKey,
    setManualKey,
    hasYErr,
    weightNote,
  };
}
