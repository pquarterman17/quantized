// Custom equation model (GOTO #1) — state hook for EquationModelPanel. Owns
// the equation text + debounced validation, the parameter table (guess/min/
// max/hold — the pure half is lib/equationRows), the before-run summary
// from the validate response (P2.7), the fit call through /api/fitting/equation/fit (same engine + result
// shape as registry fits), and save/load of named custom models
// (lib/fitmodels). Mirrors useCurveFit's row-state discipline: fits the
// analysis view (#50/#53) and expands the overlay back to full length.

import { useEffect, useMemo, useRef, useState } from "react";

import { fitEquation, validateEquation, type EquationValidateResult } from "../../../lib/api/curvefit";
import {
  equationRunProblem,
  newEquationRow,
  parseEquationRows,
  type EquationParamRow,
} from "../../../lib/equationRows";
import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { recordUse } from "../../../lib/recipeIndex";
import {
  deleteCustomModel,
  loadCustomModels,
  saveCustomModel,
  type CustomFitModel,
} from "../../../lib/fitmodels";
import { codePointSpanToUtf16, type TextSpan } from "../../../lib/equationSpan";
import { activeRowIndices, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { CalcResult, Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { toast } from "../../../store/toasts";
import { selectedFitData } from "../../../lib/fitselection";

export type { EquationParamRow };

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
  setRow: (index: number, field: "guess" | "min" | "max", value: string) => void;
  /** Hold (or release) one parameter at its guess (P2.7). */
  setHeld: (index: number, held: boolean) => void;
  /** Before-run summary from the last successful validate; null otherwise. */
  summary: EquationSummary | null;
  /** Why the fit cannot run as the table stands (every parameter held, min
   *  above max, ...), or null. The Fit button is disabled while set. */
  runProblem: string | null;
  busy: boolean;
  error: string | null;
  result: CalcResult | null;
  /** Hold flags the CURRENT result was fitted with (aligned with its
   *  params), so the results table labels held values even after the table
   *  is edited again. Empty when there is no result. */
  fitHeld: boolean[];
  paramNames: string[];
  fit: () => Promise<void>;
  clear: () => void;
  /** Save-as-named-model controls. */
  modelName: string;
  setModelName: (name: string) => void;
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
      guess: String(m.guesses[i] ?? 1),
      min: lo === null ? "" : String(lo),
      max: hi === null ? "" : String(hi),
      fixed: false,
    };
  });
}

export function useEquationFit(
  initial?: CustomFitModel | null,
  opts?: { debounceMs?: number },
): EquationFitState {
  const debounceMs = opts?.debounceMs ?? 350;
  const active = useActiveDataset();
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);

  const [equation, setEquation] = useState(initial?.equation ?? "");
  const [status, setStatus] = useState<ValidationStatus>(initial ? "ok" : "idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  // The span is tied to the exact text it was reported for, so a keystroke
  // (which re-validates after a debounce) can never mark the wrong characters.
  const [errorAt, setErrorAt] = useState<{ text: string; span: TextSpan } | null>(null);
  const [rows, setRows] = useState<EquationParamRow[]>(initial ? rowsFromModel(initial) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [fitHeld, setFitHeld] = useState<boolean[]>([]);
  const [paramNames, setParamNames] = useState<string[]>(initial ? [...initial.params] : []);
  const [modelName, setModelName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState<EquationSummary | null>(null);
  const runProblem = useMemo(() => equationRunProblem(rows), [rows]);

  // The rows the debounced validate reconciles against — a ref so the effect
  // doesn't re-fire (and re-validate) on every guess keystroke.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const xRange = useMemo(() => {
    const d = selectedFitData(active, xKey, yKeys, seriesOrder);
    if (!d) return null;
    const finite = d.x.filter((v) => Number.isFinite(v));
    if (finite.length === 0) return null;
    return { min: Math.min(...finite), max: Math.max(...finite) };
  }, [active, seriesOrder, xKey, yKeys]);

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
    let cancelled = false;
    const timer = setTimeout(() => {
      validateEquation(equation)
        .then((v) => {
          if (cancelled) return;
          if (v.ok) {
            setStatus("ok");
            setValidationError(null);
            setParamNames(v.params);
            setRows(freshRows(v.params, rowsRef.current));
            setSummary(summaryOf(v));
          } else {
            setStatus("error");
            setSummary(null);
            setValidationError(v.error ?? "invalid equation");
            const span = codePointSpanToUtf16(equation, v.errorStart, v.errorEnd);
            setErrorAt(span ? { text: equation, span } : null);
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setStatus("error");
          setSummary(null);
          setErrorAt(null);
          setValidationError(e instanceof Error ? e.message : "validation unavailable");
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [equation, debounceMs]);

  function setRow(index: number, field: "guess" | "min" | "max", value: string): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function setHeld(index: number, held: boolean): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, fixed: held } : r)));
  }

  async function fit(): Promise<void> {
    if (!active || status !== "ok" || rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = parseEquationRows(rows);
      if ("error" in parsed) throw new Error(parsed.error);
      const { guesses, lower, upper, fixed } = parsed;

      // Resolve a still-pending dataset first (#38), then fit the plotted
      // X/primary-Y over the analysis view (#50/#53) — the same channels + rows
      // the plot shows. Read the selection after the await in case the plotted
      // channels changed while a lazy Origin book resolved.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const state = useApp.getState();
      const d = selectedFitData(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (!d) return;
      const pairs = dropGapRows(d.x, d.y);
      if (pairs.x.length === 0) throw new Error("no finite X/Y pairs are available to fit");
      if (!pairs.complete) {
        toast(`${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the fit.`);
      }
      const r = await fitEquation({
        equation,
        x: pairs.x,
        y: pairs.y,
        guesses,
        ...(lower.some((v) => v !== null) ? { lower } : {}),
        ...(upper.some((v) => v !== null) ? { upper } : {}),
        ...(fixed.some(Boolean) ? { fixed } : {}),
      });
      setResult(r);
      setFitHeld(fixed);
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
      // re-executes registry models by name, which a raw equation is not.
      useApp
        .getState()
        .recordMacro(`Fit equation ${modelName || equation}`, `qz.fitEquation(${JSON.stringify(equation)})`);
      const yFit = r.yFit as (number | null)[] | undefined;
      if (Array.isArray(yFit)) {
        const n = ds.data.time.length;
        const kept = activeRowIndices(n, droppedRows(ds));
        const aligned = restoreGapRows(yFit, pairs);
        const y = kept.length === n ? aligned : expandToFull(aligned, kept, n);
        setFitOverlay({ datasetId: ds.id, y });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "fit failed");
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    setResult(null);
    setFitHeld([]);
    setError(null);
    setFitOverlay(null);
  }

  function save(): CustomFitModel[] | null {
    const name = modelName.trim();
    if (!name || status !== "ok" || rows.length === 0) return null;
    const model: CustomFitModel = {
      version: 1,
      name,
      equation,
      params: rows.map((r) => r.name),
      guesses: rows.map((r) => {
        const v = Number(r.guess);
        return Number.isFinite(v) && r.guess.trim() !== "" ? v : 1;
      }),
      lower: rows.map((r) => (r.min.trim() === "" || !Number.isFinite(Number(r.min)) ? null : Number(r.min))),
      upper: rows.map((r) => (r.max.trim() === "" || !Number.isFinite(Number(r.max)) ? null : Number(r.max))),
    };
    return saveCustomModel(model);
  }

  function remove(name: string): CustomFitModel[] {
    return deleteCustomModel(name);
  }

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
    busy,
    error,
    result,
    fitHeld,
    paramNames,
    fit,
    clear,
    modelName,
    setModelName,
    save,
    remove,
    xRange,
  };
}
