// PLOT_WORKFLOW_PLAN #3 "Plot selected together" — the shared action behind
// the command palette entry, the Plot menu item, and the Library selection
// context-menu entry (three surfaces, one implementation). Since gap audit 2
// #1 it makes a LIVE multi-dataset graph (lib/linkedCurves.ts) instead of
// copying the data into a frozen overlay: a new Library dataset named
// Origin-style "Graph1, Graph2, …" whose curves name their sources, and whose
// data store/linkedCurvesSync.ts rebuilds whenever a source changes. Each
// source contributes the curves its sheet designates, each on its own X
// (`defaultCurves`); 2-D maps are skipped (a map has no curve to contribute).
// "Add curve from…" (lib/addCurveRun.ts) extends a graph later.
//
// Loaded on demand through the eager shim lib/plotSelectedTogether.ts. Lives
// outside store/useApp.ts (that store sits at its size-ratchet pin) and needs
// no new persistent state beyond the graph dataset it adds.

import { installLinkedCurvesSync } from "../store/linkedCurvesSync";
import { toast } from "../store/toasts";
import { nextDatasetId, useApp } from "../store/useApp";
import { assembleLinkedCurves, defaultCurves, nextGraphName } from "./linkedCurves";
import { is2DMap } from "./mapdata";
import type { Dataset } from "./types";

// The other graph actions ride this same lazy chunk (lib/plotSelectedTogether.ts).
export { addCurveFrom } from "./addCurveRun";
export { installLinkedCurvesSync } from "../store/linkedCurvesSync";

const MIN_SELECTION = 2;

/** "— skipped N map dataset(s) (name, name): maps don't overlay", or "" when
 *  nothing was skipped. Shared by both the success and the not-enough-left
 *  toast so the reason is always named, never just a count. */
function mapSkipNote(maps: Dataset[]): string {
  if (maps.length === 0) return "";
  const noun = maps.length === 1 ? "map dataset" : "map datasets";
  return ` — skipped ${maps.length} ${noun} (${maps.map((d) => d.name).join(", ")}): maps don't overlay`;
}

/** Combine `ids` into one live graph. Requires ≥2 selected datasets up front
 *  (toast + return otherwise); 2-D maps within an otherwise-valid selection
 *  are skipped (named in the toast). Exported so every entry point calls the
 *  identical gate + build + land sequence. */
export async function plotSelectedTogether(ids: readonly string[]): Promise<void> {
  if (ids.length < MIN_SELECTION) {
    toast(`select at least ${MIN_SELECTION} datasets to plot together`, "danger");
    return;
  }
  // A still-pending Origin book must be fully loaded before its channels/rows
  // are readable. Every entry point fires this as `void …`, so a rejected
  // resolve must be reported here or it is invisible.
  let resolved: Dataset[];
  try {
    resolved = await useApp.getState().resolveDatasets([...ids]);
  } catch (e) {
    toast(`couldn't load the selected datasets to plot together — ${e instanceof Error ? e.message : "error"}`, "danger");
    return;
  }
  if (resolved.length < MIN_SELECTION) {
    toast("couldn't resolve enough of the selected datasets to plot together", "danger");
    return;
  }
  const maps = resolved.filter((d) => is2DMap(d.data));
  const plottable = resolved.filter((d) => !is2DMap(d.data));
  if (plottable.length < MIN_SELECTION) {
    toast(`need at least ${MIN_SELECTION} plottable datasets to overlay${mapSkipNote(maps)}`, "danger");
    return;
  }
  const curves = plottable.flatMap(defaultCurves);
  if (curves.length === 0) {
    toast("the selected datasets have no curves to plot together", "danger");
    return;
  }
  const { datasets } = useApp.getState();
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const graph: Dataset = {
    id: nextDatasetId(),
    name: nextGraphName(datasets),
    data: assembleLinkedCurves(curves, (id) => byId.get(id)),
    linkedCurves: curves,
  };
  useApp.getState().addDataset(graph);
  installLinkedCurvesSync();
  toast(`plotted ${plottable.length} datasets together as ${graph.name} — it follows its sources${mapSkipNote(maps)}`, "ok");
}
