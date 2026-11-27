// The writes behind the plot's data-slicer menu entries (lib/plotSlice.ts), loaded
// on demand from the right-click menu. Both reuse existing paths: the Data Filter
// (`applyViewFilter` -> `setDatasetFilter`) and the worksheet's Extract rows
// (`planExtract` + `commitExtract`, one undo step, linked to its source).

import { liveSelectedRows, type SlicePlan } from "../../lib/plotSlice";
import { excludedSet, filteredOutSet } from "../../lib/rowstate";
import { applyViewFilter } from "../../store/graphBrowserActions";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { describeExtract, planExtract } from "./worksheet/extractRows";
import { commitExtract } from "./worksheet/extractRowsCommit";

/** Keep only the rows inside the box: the plan's range predicates become the sheets' Data Filters. */
export function applyBoxFilter({ plan, skippedY }: SlicePlan): boolean {
  if (!applyViewFilter(plan)) return false;
  if (skippedY && plan.ok) useApp.getState().setStatus(`${plan.summary}; X window only: ${skippedY}`);
  return true;
}

/** Extract the selected points' rows to a new worksheet (the worksheet's Extract, over the plot's selection). */
export function extractSelectedPoints(): void {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || s.selection?.datasetId !== ds.id) return void toast("select points with the Select rows tool first", "danger");
  if (ds.pending) return void toast(`“${ds.name}” is still loading: extract again in a moment`, "danger");
  const rows = liveSelectedRows(s.selection.rows, excludedSet(ds), filteredOutSet(ds));
  const plan = planExtract(ds.data, rows);
  const stopped = plan ? commitExtract(ds, plan, (id) => useApp.getState().datasets.find((d) => d.id === id)?.name) : null;
  if (stopped) return s.setStatus(stopped.status, stopped.tone);
  s.setStatus(describeExtract(plan, ds.data.time.length));
}
