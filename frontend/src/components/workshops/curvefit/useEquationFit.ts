// Custom equation model (GOTO #1) — state hook for EquationModelPanel. Owns
// the equation text + debounced validation, the parameter table (guess/min/
// max/hold — the pure half is lib/equationRows), the before-run summary
// from the validate response (P2.7), the fit call through /api/fitting/equation/fit (same engine + result
// shape as registry fits), and save/load of named custom models
// (lib/fitmodels). Mirrors useCurveFit's row-state discipline: fits the
// analysis view (#50/#53) and expands the overlay back to full length.

import { maxOf, minOf } from "../../../lib/arrayExtent";
import { useEffect, useMemo, useRef, useState } from "react";

import { validateEquation, type EquationValidateResult } from "../../../lib/api/curvefit";
import { leanEquationFit } from "../../../lib/fitSource";
import { fitRowsOf } from "../../../lib/fitCurve";
import {
  equationFitStep,
  equationRunProblem,
  newEquationRow,
  parseEquationRows,
  savedModelRows,
  type EquationParamRow,
} from "../../../lib/equationRows";
import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { recordUse } from "../../../lib/recipeIndex";
import {
  buildCustomFitModel,
  checkFitModelRecord,
  deleteCustomModel,
  loadCustomModels,
  saveCustomModel,
  type CustomFitModel,
} from "../../../lib/fitmodels";
import { codePointSpanToUtf16, type TextSpan } from "../../../lib/equationSpan";
import { activeRowIndices, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { CalcResult, Dataset, FitOverlay } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { toast } from "../../../store/toasts";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { analysisTargetDataset } from "../../../lib/analysisInputs";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { datasetInputsToken } from "../workbench/inputsKey";
import { afterCommit } from "../workbench/afterCommit";
import { Refusal } from "../workbench/refusal";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { takeBackOverlay } from "./fitOverlayOwnership";

export type { EquationParamRow };

interface FitRun { result: CalcResult; held: boolean[]; units: string[] }

/** What the last successful validate said the equation is made of (P2.7). */
export interface EquationSummary {
  variable: string;
  usesX: boolean;
  functions: string[];
  constants: string[];
}

export type ValidationStatus = "idle" | "checking" | "ok" | "error";

export interface EquationFitState {
  active: Dataset | null;
  equation: string;
  setEquation: (text: string) => void;
  status: ValidationStatus;
  validationError: string | null;
  /** Where the syntax error is in `equation` (UTF-16 span), when the
   *  validate route located it (P2.7); null for any other text. */
  errorSpan: TextSpan | null;
  rows: EquationParamRow[];
  setRow: (index: number, field: "guess" | "min" | "max" | "unit", value: string) => void;
  /** Hold (or release) one parameter at its guess (P2.7). */
  setHeld: (index: number, held: boolean) => void;
  /** Before-run summary from the last successful validate; null otherwise. */
  summary: EquationSummary | null;
  /** Why the fit cannot run as the table stands (every parameter held, min
   *  above max, ...), or null. The Fit button is disabled while set. */
  runProblem: string | null;
  busy: boolean;
  error: string | null;
  /** `error` is a refusal (the table or data cannot be fitted), not a failed request. */
  refusal: boolean;
  /** The shown result was fitted under an equation, table or data that has since changed. */
  stale: boolean;
  result: CalcResult | null;
  /** Hold flags the CURRENT result was fitted with (aligned with its
   *  params), so the results table labels held values even after the table
   *  is edited again. Empty when there is no result. */
  fitHeld: boolean[];
  /** Units the CURRENT result was fitted with (trimmed; "" = none), snapshot
   *  at fit time like `fitHeld`, so editing a unit afterwards cannot relabel
   *  a value that was already reported. */
  fitUnits: string[];
  paramNames: string[];
  fit: () => Promise<void>;
  clear: () => void;
  /** Save-as-named-model controls. */
  modelName: string;
  setModelName: (name: string) => void;
  /** Saved-model description (P2.7 slice 3); "" = none. */
  description: string;
  setDescription: (text: string) => void;
  save: () => CustomFitModel[] | null;
  remove: (name: string) => CustomFitModel[];
  /** [min, max] of the fitted x data — the domain Find X/Y (MAIN #15)
   *  searches over; null when there's no analysis data yet. */
  xRange: { min: number; max: number } | null;
}

function freshRows(params: string[], prev: EquationParamRow[]): EquationParamRow[] {
  // Keep edited guesses/bounds for parameters that survive the re-validate
  // (matched by name); new parameters start at the neutral guess of 1.
  return params.map((name) => prev.find((r) => r.name === name) ?? newEquationRow(name));
}

function summaryOf(v: EquationValidateResult): EquationSummary {
  return {
    variable: v.variable ?? "x",
    usesX: v.usesX ?? true,
    functions: v.functions ?? [],
    constants: v.constants ?? [],
  };
}

function rowsFromModel(m: CustomFitModel): EquationParamRow[] {
  // isCustomFitModel guarantees guesses/lower/upper align with params.
  return m.params.map((name, i) => {
    const lo = m.lower[i];
    const hi = m.upper[i];
    return {
      name,
      guess: m.guesses[i] == null ? "" : String(m.guesses[i]), // null = auto start
      min: lo === null ? "" : String(lo),
      max: hi === null ? "" : String(hi),
      fixed: false,
      unit: m.units?.[i] ?? "",
    };
  });
}

export function useEquationFit(
  initial?: CustomFitModel | null,
  opts?: { debounceMs?: number },
): EquationFitState {
  const debounceMs = opts?.debounceMs ?? 350;
  // The SAME dataset and roles the registry modes fit (useCurveFit): the
  // Curve fit selection item (an Analysis Center / worksheet / rerun handoff,
  // or the live plot capture) wins over the active worksheet and the live
  // plot channels; a handoff naming a deleted worksheet gets no dataset. The
  // selection is seeded by useCurveFit in the parent panel; with none (this
  // panel on its own) the active worksheet and plotted channels apply.
  const fallbackActive = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const owner = useAnalysisSelection((s) => s.toolId);
  const seed = useAnalysisSelection((s) => s.selection);
  const item = owner === "curvefit" ? seed?.items[0] ?? null : null;
  const active = analysisTargetDataset(datasets, fallbackActive?.id ?? null, item, seed?.source === "tool-default");
  const selected = item && item.datasetId === active?.id ? item : null; // never another sheet's roles
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const liveXKey = useApp((s) => s.xKey);
  const liveYKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const xKey = selected?.xKey ?? liveXKey;
  const yKeys = selected?.yKeys ?? liveYKeys;

  const [equation, setEquation] = useState(initial?.equation ?? "");
  const [status, setStatus] = useState<ValidationStatus>(initial ? "ok" : "idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  // The span is tied to the exact text it was reported for, so a keystroke
  // (which re-validates after a debounce) can never mark the wrong characters.
  const [errorAt, setErrorAt] = useState<{ text: string; span: TextSpan } | null>(null);
  const [rows, setRows] = useState<EquationParamRow[]>(initial ? rowsFromModel(initial) : []);
  // Save errors and a fit refusal; a failed fit request is the preview's error.
  const [error, setError] = useState<string | null>(null);
  const [refusalText, setRefusalText] = useState<string | null>(null);
  const ownOverlay = useRef<FitOverlay | null>(null);
  const [paramNames, setParamNames] = useState<string[]>(initial ? [...initial.params] : []);
  const [modelName, setModelName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [summary, setSummary] = useState<EquationSummary | null>(null);
  const runProblem = useMemo(() => equationRunProblem(rows), [rows]);

  // The rows the debounced validate reconciles against — a ref so the effect
  // doesn't re-fire (and re-validate) on every guess keystroke.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const xRange = useMemo(() => {
    const d = selectedFitData(active, xKey, yKeys, seriesOrder, selected ?? undefined);
    if (!d) return null;
    const finite = d.x.filter((v) => Number.isFinite(v));
    if (finite.length === 0) return null;
    return { min: minOf(finite), max: maxOf(finite) };
  }, [active, selected, seriesOrder, xKey, yKeys]);

  // The equation check rides the shared workbench shell (../workbench): the
  // 350 ms debounce, abort on an edit or unmount, and an older answer can
  // never be applied to newer text. Its answer is then reconciled into the
  // parameter table below.
  const check = useWorkbenchPreview<EquationValidateResult>({
    key: equation.trim() ? equation : "",
    delayMs: debounceMs,
    fallbackError: "validation unavailable",
    run: (signal) => validateEquation(equation, signal),
  });

  useEffect(() => {
    if (!equation.trim()) {
      setStatus("idle");
      setValidationError(null);
      setRows([]);
      setParamNames([]);
      setSummary(null);
      return;
    }
    setStatus("checking");
  }, [equation]);

  // `check.current` is the answer for the CURRENT text only.
  const answer = check.current;
  useEffect(() => {
    if (!answer) return;
    if (answer.ok) {
      setStatus("ok");
      setValidationError(null);
      setParamNames(answer.params);
      setRows(freshRows(answer.params, rowsRef.current));
      setSummary(summaryOf(answer));
    } else {
      setStatus("error");
      setSummary(null);
      setValidationError(answer.error ?? "invalid equation");
      const span = codePointSpanToUtf16(equation, answer.errorStart, answer.errorEnd);
      setErrorAt(span ? { text: equation, span } : null);
    }
    // `equation` is the key the answer is for; only a new answer applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);

  const checkError = check.error;
  useEffect(() => {
    if (!checkError) return;
    setStatus("error");
    setSummary(null);
    setErrorAt(null);
    setValidationError(checkError);
  }, [checkError]);

  function setRow(index: number, field: "guess" | "min" | "max" | "unit", value: string): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function setHeld(index: number, held: boolean): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, fixed: held } : r)));
  }

  // The fit rides the shared workbench shell in MANUAL mode: nothing runs on
  // an edit, only the Fit button. The key is everything the fit depends on
  // (dataset rows / data, equation, start / bound / hold table, channels; a unit
  // label only names the result, so it is no input). A result whose key differs
  // is out of date; an answer for inputs that changed in flight is dropped.
  const key = active
    ? JSON.stringify([datasetInputsToken(active), equation, rows.map((r) => [r.name, r.guess, r.min, r.max, r.fixed]), xKey, yKeys, seriesOrder])
    : "";
  const fitRun = useWorkbenchPreview<FitRun | null>({
    key,
    auto: false,
    delayMs: 0,
    fallbackError: "fit failed",
    run: async (signal) => {
      if (!active) return null;
      setError(null);
      setRefusalText(null);
      try {
        return await runFit(signal);
      } catch (e) {
        if (e instanceof Refusal) setRefusalText(e.message);
        throw e;
      }
    },
  });

  async function runFit(signal: AbortSignal): Promise<FitRun | null> {
    if (!active) return null;
    const parsed = parseEquationRows(rows);
    if ("error" in parsed) throw new Refusal(parsed.error);
    const { guesses, lower, upper, fixed } = parsed;
    const units = rows.map((r) => r.unit.trim());

    // Resolve a still-pending dataset first (#38), then fit the plotted
    // X/primary-Y over the analysis view (#50/#53) — the same channels + rows
    // the plot shows. Read the selection after the await in case the plotted
    // channels changed while a lazy Origin book resolved.
    const ds = await useApp.getState().resolveDataset(active.id);
    if (!ds) return null;
    const state = useApp.getState();
    const currentSeed = useAnalysisSelection.getState();
    const runSelection = currentSeed.toolId === "curvefit"
      ? currentSeed.selection?.items.find((entry) => entry.datasetId === ds.id)
      : undefined;
    const runXKey = runSelection?.xKey ?? state.xKey;
    const runYKeys = runSelection?.yKeys ?? state.yKeys;
    const d = selectedFitData(ds, runXKey, runYKeys, state.seriesOrder, runSelection);
    if (!d) {
      const why = fitSelectionRefusal(ds, runXKey, runYKeys, state.seriesOrder);
      if (why) throw new Refusal(why);
      return null;
    }
    const pairs = dropGapRows(d.x, d.y);
    if (pairs.x.length === 0) throw new Refusal("no finite X/Y pairs are available to fit");
    if (!pairs.complete) {
      toast(`${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the fit.`);
    }
    const n = ds.data.time.length;
    const kept = d.sourceRows ?? activeRowIndices(n, droppedRows(ds)); // the overlay is laid back onto these
    // x/y by dataset handle when the server holds the dataset (lib/fitSource).
    const r = await leanEquationFit({
      equation,
      x: pairs.x,
      y: pairs.y,
      guesses,
      ...(lower.some((v) => v !== null) ? { lower } : {}),
      ...(upper.some((v) => v !== null) ? { upper } : {}),
      ...(fixed.some(Boolean) ? { fixed } : {}),
    }, { data: ds.data, xKey: d.xKey, yKey: d.yKey }, fitRowsOf(pairs.keep, kept, n));
    // The inputs changed (or the panel closed) while the request ran: its answer
    // is not theirs, so none of the commit paths below may fire for it.
    if (signal.aborted) return null;
    // P3.5 "recently used" — the one genuinely ambiguous kind, so it is
    // wired precisely. Selecting a saved model from the dropdown is a
    // BROWSE; the use is the fit actually running with it. And the name is
    // checked against what is really stored, because `modelName` is free
    // text a user may have typed without ever saving: recording it
    // unchecked would mint sidecar entries for models that do not exist,
    // which `pruneEntries` would then have to clean up after.
    if (modelName && loadCustomModels().some((m) => m.name === modelName)) {
      recordUse({ kind: "fitModel", scope: "global", id: modelName });
    }
    // Script-only macro step ("ui" kind): the pipeline runner's "fit" step
    // re-executes registry models by name, which a raw equation is not. It
    // carries the full setup that ran (lib/equationRows equationFitStep).
    const step = equationFitStep(equation, parsed);
    useApp
      .getState()
      .recordMacro(`Fit equation ${modelName || equation}`, step.code, { kind: "ui", params: step.params });
    const yFit = r.yFit as (number | null)[] | undefined;
    if (Array.isArray(yFit)) {
      const aligned = restoreGapRows(yFit, pairs);
      const y = kept.length === n ? aligned : expandToFull(aligned, kept, n);
      const overlay: FitOverlay = { datasetId: ds.id, binding: { yKey: d.yKey, xKey: d.xKey }, y, curveFit: true };
      ownOverlay.current = overlay;
      setFitOverlay(overlay);
    }
    return { result: r, held: fixed, units };
  }

  async function fit(): Promise<void> {
    if (!active || status !== "ok" || rows.length === 0) return;
    // Resolve a lazy book first: its arrival moves the key, which would abort a run launched before it.
    if (active.pending) {
      await useApp.getState().resolveDataset(active.id);
      await afterCommit();
    }
    return fitRun.refresh();
  }

  function clear(): void {
    fitRun.discard();
    setError(null);
    setRefusalText(null);
    setFitOverlay(null);
  }

  function save(): CustomFitModel[] | null {
    const name = modelName.trim();
    if (!name || status !== "ok" || rows.length === 0) return null;
    const numbers = savedModelRows(rows);
    if ("error" in numbers) {
      setError(`can't save the model: ${numbers.error}`);
      return null;
    }
    const model = buildCustomFitModel({
      name,
      equation,
      params: rows.map((r) => r.name),
      ...numbers,
      description,
      units: rows.map((r) => r.unit),
    });
    // The same creation check an imported model file gets (lib/fitmodels'
    // `checkFitModelRecord`): a model saved here with a typed start outside
    // its bounds would be refused on every other way in — so it is refused
    // here, naming the parameter.
    try {
      checkFitModelRecord(model);
    } catch (e) {
      setError(`can't save the model: ${e instanceof Error ? e.message : "invalid"}`);
      return null;
    }
    let list: CustomFitModel[];
    try {
      list = saveCustomModel(model);
    } catch (e) {
      // A stored record this build cannot read holds that name (lib/fitmodels).
      setError(e instanceof Error ? e.message : "could not save the model");
      return null;
    }
    // A write storage refused (full, blocked) is swallowed by the library, so
    // re-read: the model is saved only if THIS record is there — not merely
    // its name, which an older version being overwritten still holds. The
    // picker lists what storage holds (the lib/nameKeyedRecipes precedent).
    const back = loadCustomModels().find((m) => m.name === name);
    if (!back || JSON.stringify(back) !== JSON.stringify(model)) {
      setError("could not save the model — browser storage is full or unavailable");
      return null;
    }
    return list;
  }

  function remove(name: string): CustomFitModel[] {
    return deleteCustomModel(name);
  }

  const shown = fitRun.latest?.value ?? null;
  // An out-of-date fit's curve is taken off the plot (only if it is still ours).
  const outOfDate = shown !== null && fitRun.stale;
  useEffect(() => {
    if (outOfDate) takeBackOverlay(ownOverlay.current);
  }, [outOfDate]);
  const runError = error ?? (fitRun.error || null);
  return {
    active,
    equation,
    setEquation,
    status,
    validationError,
    errorSpan: errorAt && errorAt.text === equation ? errorAt.span : null,
    rows,
    setRow,
    setHeld,
    summary,
    runProblem,
    busy: fitRun.running,
    error: runError,
    refusal: runError !== null && runError === refusalText,
    stale: shown !== null && fitRun.stale,
    result: shown?.result ?? null,
    fitHeld: shown?.held ?? [],
    fitUnits: shown?.units ?? [],
    paramNames,
    fit,
    clear,
    modelName,
    setModelName,
    description,
    setDescription,
    save,
    remove,
    xRange,
  };
}
