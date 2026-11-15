// Function Plot: the store writes (lazy chunk, reached only from the Function
// Plot workshop). Kept out of the component so the view reads state through
// selectors and these imperative steps stay testable on their own.

import { asOneEditStep } from "../store/undoStep";
import { toast } from "../store/toasts";
import { noteAssembled } from "../store/linkedCurvesSync";
import { nextDatasetId, useApp } from "../store/useApp";
import { functionDataStruct, readFunctionDef, type FunctionPlotDef } from "./functionPlot";
import { assembleLinkedCurves } from "./linkedCurves";
import { appendCurve } from "./plotSelectedTogetherRun";
import type { Dataset } from "./types";

/** The x span to start from: the focused dataset's x range, else 0..10. */
export function defaultFunctionRange(): [number, number] {
  const s = useApp.getState();
  const t = s.datasets.find((d) => d.id === s.activeId)?.data.time.filter(Number.isFinite) ?? [];
  if (t.length < 2) return [0, 10];
  const lo = t.reduce((a, b) => Math.min(a, b));
  const hi = t.reduce((a, b) => Math.max(a, b));
  return lo < hi ? [lo, hi] : [0, 10];
}

/** The stored definition of dataset `id`, or null. */
export function storedFunctionDef(id: string): FunctionPlotDef | null {
  return readFunctionDef(useApp.getState().datasets.find((d) => d.id === id));
}

const curveLabel = (def: FunctionPlotDef): string => `y = ${def.expr}`;

/** Create the function dataset and append it to the focused graph as a live
 *  curve (alone when there is nothing open), as ONE undo step. The graph's own
 *  view (plotted channels, X column, styles) is left as the user had it: the
 *  dataset is added without becoming the focus. Returns its id, or null when
 *  the function cannot be sampled. */
export function addFunctionCurve(def: FunctionPlotDef): string | null {
  let data;
  try {
    data = functionDataStruct(def);
  } catch (e) {
    toast(e instanceof Error ? e.message : "the function cannot be evaluated", "danger");
    return null;
  }
  const s = useApp.getState();
  const target = s.activeId && s.datasets.some((d) => d.id === s.activeId) ? s.activeId : null;
  const used = new Set(s.datasets.map((d) => d.name));
  let k = 1;
  while (used.has(`Function${k}`)) k++;
  const fn: Dataset = { id: nextDatasetId(), name: `Function${k}`, data };
  asOneEditStep(useApp.getState, "add function curve", () => {
    if (!target) {
      s.addDataset(fn);
      return;
    }
    s.recordHistory("add function curve");
    useApp.setState((st) => ({ datasets: [...st.datasets, fn] }));
    appendCurve(target, { datasetId: fn.id, xKey: null, yKey: 0, label: curveLabel(def) });
  });
  return fn.id;
}

/** Rewrite function curve `id` from `def`: its rows, and the legend label of
 *  every graph that holds it (the graphs follow). Records one undo step when
 *  `recordUndo`; false when nothing changed or `def` cannot be sampled. */
export function rewriteFunctionCurve(id: string, def: FunctionPlotDef, recordUndo: boolean): boolean {
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === id);
  if (!target || JSON.stringify(readFunctionDef(target)) === JSON.stringify(def)) return false;
  let data;
  try {
    data = functionDataStruct(def);
  } catch {
    return false;
  }
  if (recordUndo) s.recordHistory("edit function plot");
  const label = curveLabel(def);
  useApp.setState((st) => {
    const swapped = st.datasets.map((d) => (d.id === id ? { ...d, data } : d));
    const datasets = swapped.map((g) => {
      if (!g.linkedCurves?.some((c) => c.datasetId === id)) return g;
      const curves = g.linkedCurves.map((c) => (c.datasetId === id ? { ...c, label } : c));
      return noteAssembled({ ...g, linkedCurves: curves, data: assembleLinkedCurves(curves, swapped, g.data) }, swapped);
    });
    return { datasets };
  });
  return true;
}
