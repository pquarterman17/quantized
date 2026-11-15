// Function Plot: the store writes (lazy chunk, reached only from the Function
// Plot workshop). Kept out of the component so the view reads state through
// selectors and these imperative steps stay testable on their own.

import { toast } from "../store/toasts";
import { nextDatasetId, useApp } from "../store/useApp";
import { functionDataStruct, readFunctionDef, type FunctionPlotDef } from "./functionPlot";
import { appendCurve } from "./plotSelectedTogetherRun";

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

/** Create the function dataset and append it to the focused graph as a live
 *  curve (alone when there is nothing open). Returns the new dataset id. */
export function addFunctionCurve(def: FunctionPlotDef): string {
  const s = useApp.getState();
  const target = s.activeId && s.datasets.some((d) => d.id === s.activeId) ? s.activeId : null;
  const used = new Set(s.datasets.map((d) => d.name));
  let k = 1;
  while (used.has(`Function${k}`)) k++;
  const id = nextDatasetId();
  s.addDataset({ id, name: `Function${k}`, data: functionDataStruct(def) });
  if (target) appendCurve(target, { datasetId: id, xKey: null, yKey: 0, label: `y = ${def.expr}` });
  else toast(`plotted Function${k}`, "ok");
  return id;
}

/** Rewrite function curve `id` from `def` (graphs holding it follow). Records
 *  one undo step when `recordUndo`; false when nothing changed. */
export function rewriteFunctionCurve(id: string, def: FunctionPlotDef, recordUndo: boolean): boolean {
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === id);
  if (!target || JSON.stringify(readFunctionDef(target)) === JSON.stringify(def)) return false;
  if (recordUndo) s.recordHistory("edit function plot");
  const data = functionDataStruct(def);
  useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === id ? { ...d, data } : d)) }));
  return true;
}
