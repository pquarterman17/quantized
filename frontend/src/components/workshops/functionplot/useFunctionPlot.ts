// Function Plot workshop: state hook. Holds the definition being edited and
// writes it to the library:
//   - "Add to graph" creates a function dataset (lib/functionPlot) and appends
//     it as a live curve to the focused graph (or leaves it plotted alone when
//     there is no data yet);
//   - once a function curve is selected, every valid edit rewrites its rows at
//     once, and the graphs that hold it follow (store/linkedCurvesSync).
//
// Form and store stay in step both ways: selecting a curve loads its stored
// definition into the form in the SAME update (so opening the panel never
// writes), and a change made elsewhere (Undo, Redo, a deleted curve) is loaded
// back into the form instead of being overwritten by it. One undo step per
// editing session of a curve, not one per keystroke; Undo ends the session.

import { useEffect, useMemo, useRef, useState } from "react";

import { functionParams, functionPlotProblem, readFunctionDef, type FunctionPlotDef } from "../../../lib/functionPlot";
import { addFunctionCurve, defaultFunctionRange, rewriteFunctionCurve, storedFunctionDef } from "../../../lib/functionPlotStore";
import { useApp } from "../../../store/useApp";

export interface FunctionPlotState {
  /** Function curves in the library: [id, name]. */
  curves: { id: string; name: string }[];
  /** "" = a new curve; otherwise the curve being edited live. */
  selectedId: string;
  select: (id: string) => void;
  expr: string;
  setExpr: (s: string) => void;
  paramNames: string[];
  /** A cleared box is undefined (a problem), never a silent 0. */
  params: Record<string, number | undefined>;
  setParam: (name: string, v: number | undefined) => void;
  xMin: number;
  xMax: number;
  n: number;
  setXMin: (v: number | undefined) => void;
  setXMax: (v: number | undefined) => void;
  setN: (v: number | undefined) => void;
  /** Why the definition cannot be drawn yet, or null. */
  problem: string | null;
  add: () => void;
}

interface Form {
  expr: string;
  values: Record<string, number | undefined>;
  xMin: number;
  xMax: number;
  n: number;
}

const fromDef = (d: FunctionPlotDef): Form => ({ expr: d.expr, values: { ...d.params }, xMin: d.xMin, xMax: d.xMax, n: d.n });

export function useFunctionPlot(): FunctionPlotState {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const curves = useMemo(
    () => datasets.filter((d) => readFunctionDef(d)).map((d) => ({ id: d.id, name: d.name })),
    [datasets],
  );
  const [selectedId, setSelectedId] = useState(() => (curves.some((c) => c.id === activeId) ? (activeId ?? "") : ""));
  const [form, setForm] = useState<Form>(() => {
    const stored = selectedId ? storedFunctionDef(selectedId) : null;
    if (stored) return fromDef(stored);
    const [xMin, xMax] = defaultFunctionRange();
    return { expr: "a*sin(b*x)+c", values: { a: 1, b: 1, c: 0 }, xMin, xMax, n: 200 };
  });
  const rangeTouched = useRef(false);
  const inSession = useRef(false);

  const parsed = useMemo(() => functionParams(form.expr), [form.expr]);
  const paramNames = parsed.params;
  const params = useMemo(
    () => Object.fromEntries(paramNames.map((p) => [p, p in form.values ? form.values[p] : 1])),
    [paramNames, form.values],
  );
  const def: FunctionPlotDef = {
    expr: form.expr,
    params: Object.fromEntries(paramNames.map((p) => [p, params[p] ?? 0])),
    xMin: form.xMin,
    xMax: form.xMax,
    n: form.n,
  };
  const empty = paramNames.find((p) => params[p] === undefined);
  const problem = parsed.error ?? (empty ? `enter a value for ${empty}` : functionPlotProblem(def));
  const defKey = JSON.stringify(def);

  // The selected curve's stored definition, as a key (null when absent).
  const storedKey = useApp((s) => {
    const d = selectedId ? readFunctionDef(s.datasets.find((x) => x.id === selectedId)) : null;
    return d ? JSON.stringify(d) : null;
  });
  const formKey = useRef(defKey);
  formKey.current = defKey;

  // The curve vanished (deleted, or its Add was undone): back to a new curve.
  useEffect(() => {
    if (selectedId && storedKey === null) {
      setSelectedId("");
      inSession.current = false;
    }
  }, [selectedId, storedKey]);

  // The store changed under the form (Undo/Redo/another edit): take it, and
  // end the editing session so the next edit records its own step.
  useEffect(() => {
    if (!selectedId || storedKey === null || storedKey === formKey.current) return;
    const stored = storedFunctionDef(selectedId);
    if (!stored) return;
    setForm(fromDef(stored));
    inSession.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a store change reloads the form
  }, [storedKey]);

  // Live edit: a valid change of the form writes the selected curve.
  useEffect(() => {
    if (!selectedId || problem) return;
    if (storedKey === defKey) return;
    if (rewriteFunctionCurve(selectedId, def, !inSession.current)) inSession.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a form edit (`defKey`) is the only trigger
  }, [defKey]);

  // A new curve follows the focused graph's x range until the user sets one.
  useEffect(() => {
    if (selectedId || rangeTouched.current) return;
    const [xMin, xMax] = defaultFunctionRange();
    setForm((f) => (f.xMin === xMin && f.xMax === xMax ? f : { ...f, xMin, xMax }));
  }, [activeId, selectedId]);

  function add(): void {
    if (problem) return;
    const id = addFunctionCurve(def);
    if (!id) return;
    inSession.current = false;
    setSelectedId(id);
  }

  const patch = (p: Partial<Form>): void => setForm((f) => ({ ...f, ...p }));
  return {
    curves,
    selectedId,
    select: (id) => {
      inSession.current = false;
      const stored = id ? storedFunctionDef(id) : null;
      if (stored) setForm(fromDef(stored)); // same update: the form equals the store, so nothing is written
      setSelectedId(id);
    },
    expr: form.expr,
    setExpr: (expr) => patch({ expr }),
    paramNames,
    params,
    setParam: (name, v) => setForm((f) => ({ ...f, values: { ...f.values, [name]: v } })),
    xMin: form.xMin,
    xMax: form.xMax,
    n: form.n,
    setXMin: (v) => {
      rangeTouched.current = true;
      if (v !== undefined) patch({ xMin: v });
    },
    setXMax: (v) => {
      rangeTouched.current = true;
      if (v !== undefined) patch({ xMax: v });
    },
    setN: (v) => v !== undefined && patch({ n: Math.round(v) }),
    problem,
    add,
  };
}
