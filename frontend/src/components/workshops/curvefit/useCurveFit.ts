// Curve Fit workshop — state hook (the React analogue of the MATLAB workshop
// pattern). Owns model selection + fit result; calls /api/fitting and pushes
// the fitted curve into the store as a plot overlay. The view stays thin.

import { useEffect, useMemo, useState } from "react";

import { autoGuess, bootstrapFit, listFitModels } from "../../../lib/api/curvefit";
import { exportCornerFigure } from "../../../lib/api/figures";
import { fitModel } from "../../../lib/api";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { CalcResult, Dataset, FitModel, FitWeighting, WeightMode } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { fitStepParams, selectedFitData } from "../../../lib/fitselection";
import { activeCorrectionNames, fitSpecFrom } from "../../../lib/fitselectionActions";
import {
  boundsForWire,
  parseFitParams,
  resetRows,
  rowsAreDefault,
  rowsForModel,
  type FitParamRow,
} from "../../../lib/fitParams";
import { dyForFit } from "../../../lib/fitweights";
import type { ByColumnOption } from "../useByPartition";
import { useCurveFitByLevel, type CurveFitByLevelStart, type CurveFitLevelResult } from "./useCurveFitByLevel";

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
  /** MAIN #30: editable starting values / bounds / fixed flags for the
   *  registry model. Seeded from its registry defaults; edits survive a
   *  model change when the parameter name survives. */
  paramRows: FitParamRow[];
  setParamRow: (index: number, patch: Partial<FitParamRow>) => void;
  resetParamRows: () => void;
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
  // ── "By" grouping (JMP_GAP J7 residual) ─────────────────────────────────
  // Display-only: none of it touches the plot overlay, the recorded macro/
  // pipeline step, or the durable FitSpec, and every level fits UNWEIGHTED
  // regardless of weightMode (see useCurveFitByLevel's header doc).
  byOptions: ByColumnOption[];
  byCol: number | null;
  setByCol: (i: number | null) => void;
  byLevels: { label: string }[];
  /** Uncapped level count — > byLevels.length means the partition was
   *  truncated at BY_MAX_LEVELS and the panel must say so. */
  byTotalLevels: number;
  byResults: CurveFitLevelResult[];
  byBusy: boolean;
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
  // #30: the editable parameter table. Re-seeded on a model change, KEEPING
  // edits for parameters whose name survives — models share names (amp,
  // center), and discarding a hand-tuned start on every model flip would
  // throw away work the user just did.
  const [paramRows, setParamRows] = useState<FitParamRow[]>([]);
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

  // JMP_GAP J7 residual — "By" grouping. `data` is the analysis view (guard
  // #11); the candidate By list excludes whichever columns are already
  // driving the plotted fit (grouping by the very column being fit against
  // would be redundant). useCurveFitByLevel resets to none if xKey/the
  // plotted yKey change underneath a picked By column.
  const data = useMemo(() => analysisData(active), [active]);
  const plottedYKeyNow = xy?.yKey ?? null;
  const byColumns = useMemo<ByColumnOption[]>(() => {
    if (!active) return [];
    return active.data.labels
      .map((lab, i) => ({ index: i, label: lab }))
      .filter((c) => c.index !== xKey && c.index !== plottedYKeyNow);
  }, [active, xKey, plottedYKeyNow]);

  const model = models.find((m) => m.name === modelName);
  useEffect(() => {
    setParamRows((prev) => rowsForModel(model, prev));
    // Keyed on the model identity, not the object, so a models[] refetch
    // does not wipe the user's edits.
  }, [modelName, models.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // JMP_GAP J7 residual: the SAME custom start/bounds/fixed decision the
  // un-partitioned "Fit" button makes (rowsAreDefault/parseFitParams),
  // memoized so every By level's fetch effect doesn't refire every render.
  // An invalid table (parsed.error) degrades to "no override" for the By
  // fetch rather than duplicating the main Fit button's own error surface.
  const paramsCustom = !rowsAreDefault(paramRows, model);
  const customStart = useMemo<CurveFitByLevelStart | undefined>(() => {
    if (!paramsCustom) return undefined;
    const parsed = parseFitParams(paramRows, model);
    if (parsed.error) return undefined;
    return { p0: parsed.p0, lower: parsed.lower, upper: parsed.upper, fixed: parsed.fixed };
  }, [paramsCustom, paramRows, model]);

  const byLevel = useCurveFitByLevel(active, data, byColumns, modelName, xKey, plottedYKeyNow, customStart);

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
        // #30: the user's starting values / bounds / fixed flags. An
        // UNTOUCHED table is the registry default, so it is neither sent nor
        // recorded — that keeps the request lean and the recipe honest about
        // what was actually chosen.
        const parsed = parseFitParams(paramRows, model);
        if (parsed.error) {
          setError(parsed.error);
          return;
        }
        const custom = !rowsAreDefault(paramRows, model);
        const r = await fitModel({
          model: modelName,
          x: localXy.x,
          y: localXy.y,
          ...(dy ? { dy } : {}),
          ...(custom
            ? {
                p0: parsed.p0,
                lower: parsed.lower,
                upper: parsed.upper,
                ...(parsed.fixed.some(Boolean) ? { fixed: parsed.fixed } : {}),
              }
            : {}),
        });
        setResult(r);
        setGuessOnly(false);
        // Durable fit spec (audit P1 #3): records the plotted channels + the
        // weighting ACTUALLY used (unweighted if dy couldn't resolve) so the
        // recalc graph (#1) reproduces the original fit, not time/values[0].
        const effWeight: FitWeighting = dy ? weight : { mode: "none" };
        // #30: record WHICH corrections the source carried, so a reproduction
        // cannot silently run on differently-preprocessed data.
        const spec = fitSpecFrom(
          modelName,
          state.xKey,
          localXy,
          r,
          effWeight,
          activeCorrectionNames(ds.corrections),
          custom
            ? {
                p0: parsed.p0,
                lower: boundsForWire(parsed.lower),
                upper: boundsForWire(parsed.upper),
                fixed: parsed.fixed,
              }
            : undefined,
        );
        // Same recipe into the typed step (#6) so a template/pipeline batch
        // replays THESE channels + weighting, and the pipeline view can edit
        // the model without losing the provenance.
        useApp.getState().recordMacro(`Fit ${modelName}`, `qz.fit("${modelName}")`, {
          kind: "fit",
          params: fitStepParams(modelName, spec),
        });
        useApp.getState().setFitSpec(ds.id, spec);
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
    paramRows,
    setParamRow: (index, patch) =>
      setParamRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r))),
    resetParamRows: () => setParamRows(resetRows(model)),
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
    byOptions: byLevel.byOptions,
    byCol: byLevel.byCol,
    setByCol: byLevel.setByCol,
    byLevels: byLevel.levels,
    byTotalLevels: byLevel.totalLevels,
    byResults: byLevel.results,
    byBusy: byLevel.busy,
  };
}
