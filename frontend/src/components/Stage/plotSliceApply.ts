// The writes behind the plot's data-slicer menu entries (lib/plotSlice.ts), loaded
// on demand from the right-click menu. Both reuse existing paths: the Data Filter
// (`applyViewFilter` -> `setDatasetFilter`) and the worksheet's Extract rows
// (`planExtract` + `commitExtract`, one undo step, linked to its source).

import { effectiveChannels } from "../../lib/plotdata";
import { liveSelectedRows, type SlicePlan } from "../../lib/plotSlice";
import { excludedSet, filteredOutSet } from "../../lib/rowstate";
import { applyViewFilter } from "../../store/graphBrowserActions";
import { toast } from "../../store/toasts";
import type { AppState } from "../../store/useApp";
import { subsetWithChoices } from "./subsetWithChoices";
import { describeExtract, planExtract } from "./worksheet/extractRows";

/** The live store snapshot, passed in by the menu (a component file must not reach for the store itself). */
type Get = () => AppState;

/** Keep only the rows inside the box: the plan's range predicates become the sheets' Data Filters. */
export function applyBoxFilter({ plan, skippedY }: SlicePlan, get: Get): boolean {
  if (!applyViewFilter(plan)) return false;
  if (skippedY && plan.ok) get().setStatus(`${plan.summary}; X window only: ${skippedY}`);
  return true;
}

/** "Create subset from region": the selected points' rows to a new worksheet linked back to its source rows (the
 *  worksheet's Extract, over the plot's selection). It first asks which plotted series go into the subset (each with
 *  its row count in the region) and which workbook it lands in (the source's by default). Added beside the source
 *  WITHOUT activating it, so the graph keeps focus; the toast's Open goes to it, and Go to Source (its worksheet menu)
 *  comes back to exactly these rows. A series left unticked is left out of the subset's columns; a sheet whose per-column
 *  metadata cannot be renumbered refuses that (the status says why) and makes no subset. */
export async function createSubsetFromRegion(get: Get): Promise<void> {
  const s = get();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || s.selection?.datasetId !== ds.id) return void toast("select points with the Select rows tool first", "danger");
  if (ds.pending) return void toast(`“${ds.name}” is still loading: extract again in a moment`, "danger");
  const rows = liveSelectedRows(s.selection.rows, excludedSet(ds), filteredOutSet(ds));
  const plan = planExtract(ds.data, rows);
  if (!plan) return s.setStatus(describeExtract(plan, ds.data.time.length));
  const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder).filter((c) => !s.hiddenChannels.includes(c));
  await subsetWithChoices(get, ds, plan, plotted, true);
}
