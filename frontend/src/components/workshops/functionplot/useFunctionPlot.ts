// Function Plot workshop: state hook. Holds the definition being edited and
// writes it to the library:
//   - "Add to graph" creates a function dataset (lib/functionPlot) and appends
//     it as a live curve to the focused graph (or leaves it plotted alone when
//     there is no data yet);
//   - once a function curve is selected, every valid edit rewrites its rows at
//     once, and the graphs that hold it follow (store/linkedCurvesSync).
// One undo step per editing session of a curve, not one per keystroke.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  functionParams,
  functionPlotProblem,
  readFunctionDef,
  type FunctionPlotDef,
} from "../../../lib/functionPlot";
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
  params: Record<string, number>;
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

export function useFunctionPlot(): FunctionPlotState {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const curves = useMemo(
    () => datasets.filter((d) => readFunctionDef(d)).map((d) => ({ id: d.id, name: d.name })),
    [datasets],
  );
  const [selectedId, setSelectedId] = useState(() => (curves.some((c) => c.id === activeId) ? (activeId ?? "") : ""));
  const [initial] = useState(defaultFunctionRange);
  const [expr, setExpr] = useState("a*sin(b*x)+c");
  const [values, setValues] = useState<Record<string, number>>({ a: 1, b: 1, c: 0 });
  const [xMin, setXMinState] = useState(initial[0]);
  const [xMax, setXMaxState] = useState(initial[1]);
  const [n, setNState] = useState(200);
  const loaded = useRef<string | null>(null);
  const undoStepped = useRef<string | null>(null);

  const parsed = useMemo(() => functionParams(expr), [expr]);
  const paramNames = parsed.params;
  const params = useMemo(
    () => Object.fromEntries(paramNames.map((p) => [p, values[p] ?? 1])),
    [paramNames, values],
  );
  const def: FunctionPlotDef = { expr, params, xMin, xMax, n };
  const problem = parsed.error ?? functionPlotProblem(def);

  // Load a selected curve's stored definition into the form.
  useEffect(() => {
    if (!selectedId || loaded.current === selectedId) return;
    const stored = storedFunctionDef(selectedId);
    if (!stored) return;
    loaded.current = selectedId;
    setExpr(stored.expr);
    setValues(stored.params);
    setXMinState(stored.xMin);
    setXMaxState(stored.xMax);
    setNState(stored.n);
  }, [selectedId]);

  // Live edit: a valid change to a selected curve rewrites its rows.
  const defKey = JSON.stringify(def);
  useEffect(() => {
    if (!selectedId || loaded.current !== selectedId || problem) return;
    if (rewriteFunctionCurve(selectedId, def, undoStepped.current !== selectedId)) undoStepped.current = selectedId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `defKey` is `def`
  }, [defKey, selectedId, problem]);

  function add(): void {
    if (problem) return;
    const id = addFunctionCurve(def);
    loaded.current = id;
    undoStepped.current = null;
    setSelectedId(id);
  }

  return {
    curves,
    selectedId,
    select: (id) => {
      loaded.current = null;
      setSelectedId(id);
    },
    expr,
    setExpr,
    paramNames,
    params,
    setParam: (name, v) => setValues((cur) => ({ ...cur, [name]: v ?? 0 })),
    xMin,
    xMax,
    n,
    setXMin: (v) => v !== undefined && setXMinState(v),
    setXMax: (v) => v !== undefined && setXMaxState(v),
    setN: (v) => v !== undefined && setNState(Math.round(v)),
    problem,
    add,
  };
}
