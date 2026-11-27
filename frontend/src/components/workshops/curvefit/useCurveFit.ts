// Curve Fit workshop — state hook (the React analogue of the MATLAB workshop
// pattern). Owns model selection + fit result; calls /api/fitting and pushes
// the fitted curve into the store as a plot overlay. The view stays thin.

import { useEffect, useMemo, useRef, useState } from "react";

import { listFitModels } from "../../../lib/api/curvefit";
import { useLatestRef } from "../../../lib/previewKey";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { type Failure, failureOf } from "../workbench/refusal";
import { fitOnce, guessFit } from "./curveFitRun";
import { maxOf, minOf } from "../../../lib/arrayExtent";
import { analysisData } from "../../../lib/rowstate";
import type { CalcResult, Dataset, FitModel, FitWeighting, WeightMode } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useEffectiveErrKeys } from "../../../store/useEffectiveErrKeys";
import { fitChannelOf, selectedFitData } from "../../../lib/fitselection";
import { ownXKey } from "../../../lib/perSeriesX";
import {
  parseFitParams,
  resetRows,
  rowsAreDefault,
  rowsFromFitSpec,
  rowsForModel,
  type FitParamRow,
} from "../../../lib/fitParams";
import type { ByColumnOption } from "../useByPartition";
import { useCurveFitByLevel, type CurveFitByLevelStart, type CurveFitByLevelState, type CurveFitLevelResult } from "./useCurveFitByLevel";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";
import { analysisSelectionData } from "../../../lib/analysisSelection";
import { analysisTargetDataset } from "../../../lib/analysisInputs";
import { exportCornerPlot } from "./curveFitCornerPlot";
import { weightingNow, weightingOf } from "./fitWeighting";
import { byColumnOptions } from "./byColumnOptions";
import { followRefits } from "../../../store/curveFitRefit";
import { removeCurveFit, showRetainedCurve } from "../../../store/curveFitRemove";
import { fitInputsChanged, onRetainedFitChange, restoreFitted, type Fitted, type FittedData } from "../../../store/curveFitSession";

export type { FittedData } from "../../../store/curveFitSession";

export interface CurveFitState {
  active: Dataset | null;
  models: FitModel[];
  modelName: string;
  setModelName: (name: string) => void;
  result: CalcResult | null;
  /** The data selected for fitting is no longer what `result` was fitted to. */
  resultStale: boolean;
  /** The (x, y) pairs the last completed fit ran on — the rows its
   *  `residuals`/`yFit` align to. Null after a guess or clear. */
  fitData: FittedData | null;
  guessOnly: boolean;
  busy: boolean;
  error: string | null;
  /** `error` is a refusal (the fit cannot run on these inputs), not the backend failing. */
  refusal: boolean;
  run: (kind: "guess" | "fit") => Promise<void>;
  /** REMOVE the fit: curve, FitSpec (so auto re-fit) and the retained result.
   *  Closing the panel must NOT call this — closing only hides. */
  clear: () => void;
  /** Bootstraps the current fit (return_samples: true) then exports a
   *  pairwise corner (pairs) plot of the parameter uncertainty — gap #29's
   *  remaining UI leg. Requires a completed (non-guess) fit result. */
  runCornerPlot: () => Promise<void>;
  cornerBusy: boolean;
  /** [min, max] of the fitted x data — the domain Find X/Y (MAIN #15)
   *  searches over; null when there's no analysis data yet. */
  xRange: { min: number; max: number } | null;
  /** The fit's (x, y) as selected, for the initial-guess preview. */
  fitXy: { x: number[]; y: number[]; xKey: number | null } | null;
  /** MAIN #30: editable starting values / bounds / fixed flags for the
   *  registry model. Seeded from its registry defaults; edits survive a
   *  model change when the parameter name survives. */
  paramRows: FitParamRow[];
  setParamRow: (index: number, patch: Partial<FitParamRow>) => void;
  /** Replace the whole table (a fit template's rows). */
  replaceParamRows: (rows: FitParamRow[]) => void;
  resetParamRows: () => void;
  /** Weighting (Sol audit): mode selector + a picked sigma column for `manual`. */
  weightMode: WeightMode;
  setWeightMode: (m: WeightMode) => void;
  manualKey: number | null;
  setManualKey: (k: number | null) => void;
  /** Origin's "Scale Error with sqrt(Reduced Chi-Sqr)" for a weighted fit
   *  (default on); off = the error column is absolute sigmas. */
  scaleErrors: boolean;
  setScaleErrors: (on: boolean) => void;
  /** True when the primary fit channel has a designated error column (enables
   *  the "Y error column" mode). */
  hasYErr: boolean;
  /** Non-fatal weighting note (e.g. missing/invalid error column → fit ran
   *  unweighted); null when weighting resolved cleanly. */
  weightNote: string | null;
  // ── "By" grouping (JMP_GAP J7 residual): display-only, honours the panel's
  // weighting; never touches the overlay, macro step or FitSpec (see useCurveFitByLevel).
  byOptions: ByColumnOption[];
  byCol: number | null;
  setByCol: (i: number | null) => void;
  byLevels: { label: string }[];
  /** Uncapped level count — > byLevels.length means the partition was
   *  truncated at BY_MAX_LEVELS and the panel must say so. */
  byTotalLevels: number;
  byResults: CurveFitLevelResult[];
  byBusy: boolean;
  byRun: CurveFitByLevelState; // for "Save By result": its `current` / `provenance`
}

/** `lastUsed.current` (when set) is called once per successful fit: the preset bar's "last used". */
export function useCurveFit(lastUsed?: { current: (() => void) | null }): CurveFitState {
  const fallbackActive = useActiveDataset();
  const selection = useToolAnalysisSelection("curvefit");
  const datasets = useApp((s) => s.datasets);
  const active = analysisTargetDataset(datasets, fallbackActive?.id ?? null, selection?.items[0], selection?.source === "tool-default");
  const selected = selection?.items[0]?.datasetId === active?.id ? selection?.items[0] ?? null : null; // never another sheet's roles
  const setStatus = useApp((s) => s.setStatus);
  const liveXKey = useApp((s) => s.xKey);
  const liveYKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const liveErrKeys = useEffectiveErrKeys();
  const xKey = selected?.xKey ?? liveXKey;
  const yKeys = selected?.yKeys ?? liveYKeys;
  const errKeys = selected?.errorKeys ?? liveErrKeys;
  const savedSpec = active?.fitSpec;
  const restoredRecipe = useRef(false);
  const [models, setModels] = useState<FitModel[]>([]);
  const [modelName, setModelName] = useState(savedSpec?.model ?? "Linear");
  // #30: the editable parameter table. Re-seeded on a model change, KEEPING
  // edits for parameters whose name survives — models share names (amp,
  // center), and discarding a hand-tuned start on every model flip would
  // throw away work the user just did.
  const [paramRows, setParamRows] = useState<FitParamRow[]>([]);
  // The result, keyed to the dataset + model + X/Y channels it was computed
  // for, and shown (so reportable) only under that pick: "→ Report" titles
  // and references the CURRENT dataset/model, and the corner plot bootstraps
  // the CURRENT x/y, so a dataset/model/channel change (or a fit landing
  // after one) would otherwise ship or seed with another fit's parameters.
  // Restored from the session on mount: closing the panel only hides it.
  // `fitted` is what THIS mount computed (a guess or a fit). Each worksheet's
  // last fit is also kept in the session (store/curveFitSession.ts), which is
  // what shows after a reopen, on coming back to a worksheet fitted earlier,
  // and after an Undo of "Remove fit".
  const [fitted, setFitted] = useState<Fitted | null>(null);
  const [, sessionChanged] = useState(0);
  // Undo of "Remove fit" shows the result again, Redo drops it
  // (curveFitRemove.ts); a background re-fit replaces it (curveFitRefit.ts).
  useEffect(() => {
    followRefits();
    return onRetainedFitChange((kept, present, replaces) => {
      setFitted((f) => (f === kept && !present ? null : f === replaces ? kept : f));
      sessionChanged((v) => v + 1);
    });
  }, []);
  const [busy, setBusy] = useState(false);
  // A guess / corner-plot failure; it carries its kind (a typed `Refusal`).
  const [error, setError] = useState<Failure | null>(null);
  const [cornerBusy, setCornerBusy] = useState(false);
  const [weightMode, setWeightMode] = useState<WeightMode>(savedSpec?.weight?.mode ?? "none");
  const [manualKey, setManualKey] = useState<number | null>(
    savedSpec?.weight?.mode === "manual" || savedSpec?.weight?.mode === "direct"
      ? savedSpec.weight.errKey ?? null
      : null,
  );
  // The manual weight column follows its label too (../useFollowColumnPicks).
  useFollowColumnPicks(active, (follow) => {
    const next = manualKey === null ? null : follow(manualKey);
    if (next !== manualKey) setManualKey(next);
  });
  const [weightNote, setWeightNote] = useState<string | null>(null);
  const [scaleErrors, setScaleErrors] = useState(savedSpec?.weight?.scaleErrors !== false);

  /** The weighting choice for a given primary channel (./fitWeighting). */
  const weightingFor = (yKey: number): FitWeighting => weightingOf(weightMode, errKeys, manualKey, scaleErrors, yKey);

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
  const xy = useMemo(() => selectedFitData(active, xKey, yKeys, seriesOrder, selected ?? undefined), [active, seriesOrder, xKey, yKeys, selected]);

  const xRange = useMemo(() => {
    if (!xy) return null;
    const finite = xy.x.filter((v) => Number.isFinite(v));
    if (finite.length === 0) return null;
    return { min: minOf(finite), max: maxOf(finite) };
  }, [xy]);

  // The "Y error column" mode is only meaningful when the primary fit channel
  // has a designated error column (from Origin designations or manual pairing).
  // Channel identity only (no rows): a lazy preview still names its channel.
  const channel = useMemo(() => {
    const c = active ? fitChannelOf(active, xKey, yKeys, seriesOrder) : null;
    return c && !c.refusal && c.yKey !== undefined ? { yKey: c.yKey } : null;
  }, [active, seriesOrder, xKey, yKeys]);
  const hasYErr = channel != null && errKeys[channel.yKey] != null;

  // JMP_GAP J7 residual — "By" grouping. `data` is the analysis view (guard
  // #11); the candidate By list excludes whichever columns are already
  // driving the plotted fit (grouping by the very column being fit against
  // would be redundant). useCurveFitByLevel resets to none if xKey/the
  // plotted yKey change underneath a picked By column.
  const data = useMemo(
    () => active ? (selected ? analysisSelectionData(active, selected) : analysisData(active)) : null,
    [active, selected],
  );
  const plottedYKeyNow = channel?.yKey ?? null;
  const byColumns = useMemo<ByColumnOption[]>(() => byColumnOptions(active, xKey, plottedYKeyNow), [active, xKey, plottedYKeyNow]);

  const model = models.find((m) => m.name === modelName);
  const shown = fitted?.datasetId === active?.id ? fitted : restoreFitted(datasets, active?.id ?? null);
  const current =
    shown &&
    shown.datasetId === active?.id &&
    shown.model === modelName &&
    shown.xKey === (active && plottedYKeyNow !== null ? ownXKey(active, xKey, plottedYKeyNow) : xKey) &&
    shown.yKey === plottedYKeyNow
      ? shown
      : null;
  // A guess carries no fitted pairs; a completed fit always does.
  const guessOnly = current != null && current.fitData === null;
  const result = current?.result ?? null;
  const fitData = current?.fitData ?? null;
  // The untouched start table is the registry default (neither sent nor recorded), so it is no setting: seeding it when the model list loads is not an edit.
  const settingsKey = active ? JSON.stringify([active.id, modelName, xKey, yKeys, seriesOrder, errKeys, paramRows.length === 0 || rowsAreDefault(paramRows, model) ? null : paramRows, weightMode, manualKey, scaleErrors]) : "";
  const runKeys = useRef(new WeakMap<Fitted, string>());
  const settingsKeyRef = useLatestRef(settingsKey);
  // A fit restored from the session (a reopen, a worksheet revisited) has no
  // run key: it is taken to match the settings first shown beside it, so an
  // edit made after that marks it out of date like a fresh fit.
  const shownResult = shown;
  useEffect(() => {
    if (shownResult && !runKeys.current.has(shownResult)) runKeys.current.set(shownResult, settingsKey);
  }, [shownResult, settingsKey]);
  const settingsStale = !!fitData && !!shown && (runKeys.current.get(shown) ?? settingsKey) !== settingsKey;
  const dataStale = useMemo(
    () => !!fitData && !!xy && !!active &&
      fitInputsChanged(xy, fitData, weightingNow(active, xy, weightingOf(weightMode, errKeys, manualKey, scaleErrors, xy.yKey))),
    [xy, fitData, active, weightMode, errKeys, manualKey, scaleErrors],
  );
  const resultStale = dataStale || settingsStale;
  const plotId = useApp((s) => s.activeId);
  // Back on a worksheet fitted earlier: its curve is drawn again (never a
  // curve the data has since moved away from).
  useEffect(() => {
    if (fitData && !resultStale && plotId === current?.datasetId) showRetainedCurve(plotId);
  }, [current, fitData, resultStale, plotId]);
  const rowsModel = useRef<FitModel | undefined>(undefined);
  useEffect(() => {
    if (!restoredRecipe.current && savedSpec?.model === modelName && model) {
      setParamRows(rowsFromFitSpec(model, savedSpec));
      restoredRecipe.current = true;
    } else {
      const before = rowsModel.current;
      setParamRows((prev) => rowsForModel(model, prev, before));
    }
    rowsModel.current = model;
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

  const byWeight = useMemo<FitWeighting | undefined>(
    () => (plottedYKeyNow == null || weightMode === "none" ? undefined
      : weightingOf(weightMode, errKeys, manualKey, scaleErrors, plottedYKeyNow)),
    [weightMode, errKeys, manualKey, scaleErrors, plottedYKeyNow],
  );
  const byLevel = useCurveFitByLevel(
    active, data, byColumns, modelName, xKey, plottedYKeyNow, customStart, byWeight,
    selected?.factorKeys[0] ?? null, selected,
  );

  // The fit rides the shared workbench shell (../workbench) in MANUAL mode:
  // nothing runs on an edit, only the Fit button. Its key is every SETTING the
  // fit depends on (data changes are `fitInputsChanged` above): a result whose
  // run key differs from the current one is out of date, and an error belongs
  // to the key it ran with.
  const preview = useWorkbenchPreview<Fitted | null>({
    key: settingsKey,
    auto: false,
    delayMs: 0,
    fallbackError: "fit failed",
    run: async () => {
      if (!active) return null;
      const record = lastUsed?.current; // the settings as launched
      const launchKey = settingsKeyRef.current; // what this run was asked with, not what it ends up under
      setBusy(true);
      setError(null);
      try {
        return await fitOnce({
          activeId: active.id, modelName, model, paramRows, weightingFor, setWeightNote,
          onFitted: (done) => { runKeys.current.set(done, launchKey); setFitted(done); record?.(); },
        });
      } finally {
        setBusy(false);
      }
    },
  });
  const runError = error?.message ?? (preview.error || null);
  const refusal = error ? error.refusal : runError !== null && preview.refusal;

  async function run(kind: "guess" | "fit"): Promise<void> {
    if (!active) return;
    if (kind === "fit") return preview.refresh();
    setBusy(true);
    setError(null);
    try {
      const g = await guessFit(active.id, modelName);
      if (g) setFitted(g);
    } catch (e) {
      setError(failureOf(e, "fit failed"));
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    preview.discard();
    setFitted(null);
    setError(null);
    setWeightNote(null);
    removeCurveFit(active?.id ?? null);
  }

  async function runCornerPlot(): Promise<void> {
    if (!active || !xy || !result || guessOnly) return;
    const p0 = (result.params as number[] | undefined) ?? [];
    if (p0.length === 0) return;
    setCornerBusy(true);
    setError(null);
    try {
      const done = await exportCornerPlot({ dataset: active, model: modelName, paramNames: model?.paramNames ?? [], x: xy.x, y: xy.y, p0 });
      if (!done) setStatus("corner plot cancelled");
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "corner plot failed", refusal: false });
    } finally {
      setCornerBusy(false);
    }
  }

  return {
    paramRows,
    setParamRow: (index, patch) =>
      setParamRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r))),
    replaceParamRows: (rows) => setParamRows(rows.map((r) => ({ ...r }))),
    resetParamRows: () => setParamRows(resetRows(model)),
    active,
    models,
    modelName,
    setModelName,
    result,
    fitData,
    resultStale,
    guessOnly,
    busy,
    error: runError,
    refusal,
    run,
    clear,
    runCornerPlot,
    cornerBusy,
    xRange,
    fitXy: xy,
    weightMode,
    setWeightMode,
    manualKey,
    setManualKey,
    scaleErrors,
    setScaleErrors,
    hasYErr,
    weightNote,
    byOptions: byLevel.byOptions,
    byCol: byLevel.byCol,
    setByCol: byLevel.setByCol,
    byLevels: byLevel.levels,
    byTotalLevels: byLevel.totalLevels,
    byResults: byLevel.results,
    byBusy: byLevel.busy,
    byRun: byLevel,
  };
}
