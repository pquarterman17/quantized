// Custom equation model (GOTO #1) — state hook for EquationModelPanel. Owns
// the equation text + debounced validation, the parameter table (guess/min/
// max), the fit call through /api/fitting/equation/fit (same engine + result
// shape as registry fits), and save/load of named custom models
// (lib/fitmodels). Mirrors useCurveFit's row-state discipline: fits the
// analysis view (#50/#53) and expands the overlay back to full length.

import { useEffect, useMemo, useRef, useState } from "react";

import { fitEquation, validateEquation } from "../../../lib/api";
import {
  deleteCustomModel,
  saveCustomModel,
  type CustomFitModel,
} from "../../../lib/fitmodels";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { CalcResult, Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface EquationParamRow {
  name: string;
  guess: string; // kept as text while editing; parsed at fit time
  min: string; // "" = unbounded
  max: string; // "" = unbounded
}

export type ValidationStatus = "idle" | "checking" | "ok" | "error";

export interface EquationFitState {
  active: Dataset | null;
  equation: string;
  setEquation: (text: string) => void;
  status: ValidationStatus;
  validationError: string | null;
  rows: EquationParamRow[];
  setRow: (index: number, field: "guess" | "min" | "max", value: string) => void;
  busy: boolean;
  error: string | null;
  result: CalcResult | null;
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
  return params.map(
    (name) => prev.find((r) => r.name === name) ?? { name, guess: "1", min: "", max: "" },
  );
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

  const [equation, setEquation] = useState(initial?.equation ?? "");
  const [status, setStatus] = useState<ValidationStatus>(initial ? "ok" : "idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [rows, setRows] = useState<EquationParamRow[]>(initial ? rowsFromModel(initial) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [paramNames, setParamNames] = useState<string[]>(initial ? [...initial.params] : []);
  const [modelName, setModelName] = useState(initial?.name ?? "");

  // The rows the debounced validate reconciles against — a ref so the effect
  // doesn't re-fire (and re-validate) on every guess keystroke.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const xRange = useMemo(() => {
    const d = analysisData(active);
    if (!d) return null;
    const finite = d.time.filter((v) => Number.isFinite(v));
    if (finite.length === 0) return null;
    return { min: Math.min(...finite), max: Math.max(...finite) };
  }, [active]);

  useEffect(() => {
    if (!equation.trim()) {
      setStatus("idle");
      setValidationError(null);
      setRows([]);
      setParamNames([]);
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
          } else {
            setStatus("error");
            setValidationError(v.error ?? "invalid equation");
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setStatus("error");
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

  function parseBound(text: string, which: "min" | "max", name: string): number | null {
    if (text.trim() === "") return null;
    const v = Number(text);
    if (!Number.isFinite(v)) throw new Error(`${which} for "${name}" is not a number`);
    return v;
  }

  async function fit(): Promise<void> {
    if (!active || status !== "ok" || rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const guesses = rows.map((r) => {
        const v = Number(r.guess);
        if (r.guess.trim() === "" || !Number.isFinite(v)) {
          throw new Error(`guess for "${r.name}" is not a number`);
        }
        return v;
      });
      const lower = rows.map((r) => parseBound(r.min, "min", r.name));
      const upper = rows.map((r) => parseBound(r.max, "max", r.name));

      // Resolve a still-pending dataset first (#38), then fit the analysis
      // view (#50/#53) — the same rows the plot hides/greys.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const d = analysisData(ds);
      if (!d) return;
      const r = await fitEquation({
        equation,
        x: d.time,
        y: d.values.map((row) => row[0]),
        guesses,
        ...(lower.some((v) => v !== null) ? { lower } : {}),
        ...(upper.some((v) => v !== null) ? { upper } : {}),
      });
      setResult(r);
      // Script-only macro step ("ui" kind): the pipeline runner's "fit" step
      // re-executes registry models by name, which a raw equation is not.
      useApp
        .getState()
        .recordMacro(`Fit equation ${modelName || equation}`, `qz.fitEquation(${JSON.stringify(equation)})`);
      const yFit = r.yFit as (number | null)[] | undefined;
      if (Array.isArray(yFit)) {
        const n = ds.data.time.length;
        const kept = activeRowIndices(n, droppedRows(ds));
        const y = kept.length === n ? yFit : expandToFull(yFit, kept, n);
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
    rows,
    setRow,
    busy,
    error,
    result,
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
