// PLOT_WORKFLOW_PLAN #3 "Plot selected together" — the shared action behind
// the command palette entry, the Plot menu item, and the Library selection
// context-menu entry (three surfaces, one implementation, same shape as the
// panel-layout quick picks in commands/plotCommands.ts and
// lib/contextActions.ts's datasetMultiSelectActions). Resolves the current
// multi-selection, filters out 2-D maps (a map has no single curve to
// contribute — see lib/mapdata.is2DMap), and lands ONE LIVE graph: a Library
// dataset whose `linkedCurves` reference each source's default curve and
// whose rows are re-assembled whenever a source changes (lib/linkedCurves.ts,
// store/linkedCurvesSync.ts — origin gap audit 2 #1; it used to be a frozen
// copy). store/useApp.ts's addDataset activates it, retargets the focused
// window, and resets the view — see that function's own doc.
//
// "Add curve from…" opens Layer Contents (store/layerContentsApply.ts, gap
// audit 3 N1), which adds, removes, reorders and re-binds curves in one dialog;
// `appendCurve` below remains the one-curve programmatic path.
//
// Loaded on demand through the eager shim lib/plotSelectedTogether.ts.

import { noteAssembled, watchLinkedCurves } from "../store/linkedCurvesSync";
import { toast } from "../store/toasts";
import { nextDatasetId, useApp } from "../store/useApp";
import { assembleLinkedCurves, curvesForDatasets, linkedGraphReaches, linkedGraphYTitle } from "./linkedCurves";
import { is2DMap } from "./mapdata";
import { curveX } from "./perSeriesX";
import { effectiveChannels } from "./plotdata";
import { primaryChannel } from "./plotdataExtras";
import type { Dataset, LinkedCurve } from "./types";

const MIN_SELECTION = 2;

/** "— skipped N map dataset(s) (name, name): maps don't overlay", or "" when
 *  nothing was skipped. Shared by both the success and the not-enough-left
 *  toast so the reason is always named, never just a count. */
function mapSkipNote(maps: Dataset[]): string {
  if (maps.length === 0) return "";
  const noun = maps.length === 1 ? "map dataset" : "map datasets";
  return ` — skipped ${maps.length} ${noun} (${maps.map((d) => d.name).join(", ")}): maps don't overlay`;
}

/** The next free Origin-style graph name: Graph1, Graph2, ... (unique in the Library). */
function nextGraphName(datasets: readonly Dataset[]): string {
  const taken = new Set(datasets.map((d) => d.name));
  let n = 1;
  while (taken.has(`Graph${n}`)) n++;
  return `Graph${n}`;
}

/** Add the live graph over `curves` as a new Library dataset and plot it. */
export function landGraph(curves: LinkedCurve[]): Dataset {
  const datasets = useApp.getState().datasets;
  const graph = noteAssembled({ id: nextDatasetId(), name: nextGraphName(datasets), data: assembleLinkedCurves(curves, datasets), linkedCurves: curves }, datasets);
  useApp.getState().addDataset(graph);
  // Titled by what is plotted, not by which datasets (the curve labels).
  useApp.setState({ yAxisLabel: linkedGraphYTitle(curves, datasets) });
  watchLinkedCurves();
  return graph;
}

/** Combine `ids` into one live graph, one curve per dataset. Requires ≥2
 *  selected datasets up front (toast + return otherwise); 2-D maps within an
 *  otherwise-valid selection are skipped (named in the toast) rather than
 *  failing the whole command, since the remaining datasets can still overlay
 *  fine. Exported so every entry point (palette/menu command, Library
 *  context menu) calls the identical gate + build + land sequence. */
export async function plotSelectedTogether(ids: readonly string[]): Promise<void> {
  if (ids.length < MIN_SELECTION) {
    toast(`select at least ${MIN_SELECTION} datasets to plot together`, "danger");
    return;
  }
  // #38-style deferred edge: a still-pending Origin book (lazy multi-book
  // import) must be fully loaded before its channels/rows are readable.
  // Every entry point fires this as `void …`, so a rejected resolve must be
  // reported here or it is invisible (silent-failure audit 2026-10-01).
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
  // A dataset with no plottable channel contributes no curve (skipped honestly).
  const curves = curvesForDatasets(plottable, (ds) => primaryChannel(ds.data));
  if (curves.length < MIN_SELECTION) {
    toast("couldn't build an overlay from the selected datasets", "danger");
    return;
  }
  landGraph(curves);
  toast(`plotted ${curves.length === plottable.length ? `${curves.length} datasets` : `${curves.length} curves from ${plottable.length} datasets`} together — the graph follows its sources${mapSkipNote(maps)}`, "ok");
}

/** The curves a plain dataset's FOCUSED graph draws now, each against the X
 *  it is drawn on (its own X column on a multi-X sheet, lib/perSeriesX.ts). */
export function drawnCurves(ds: Dataset): LinkedCurve[] {
  const s = useApp.getState();
  const own = curveX(ds, s.xKey);
  const channels = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder).filter(
    (c) => !s.hiddenChannels.includes(c),
  );
  return channels.map((c) => ({
    datasetId: ds.id,
    xKey: own[c] === undefined ? s.xKey : own[c],
    yKey: c,
    label: s.seriesLabels[c] ?? ds.data.labels[c] ?? "",
  }));
}

/** Add `curve` to the graph `targetId` shows. */
export function appendCurve(targetId: string, curve: LinkedCurve): void {
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === targetId);
  if (!target) return;
  // Fail closed: never write a curve that makes `target` depend on itself.
  if (linkedGraphReaches(s.datasets, curve.datasetId, targetId)) {
    toast(`can't add “${curve.label}” to “${target.name}”: the two graphs would depend on each other`, "danger");
    return;
  }
  if (target.linkedCurves) {
    s.recordHistory("add curve");
    const curves = [...target.linkedCurves, curve];
    const data = assembleLinkedCurves(curves, s.datasets, target.data);
    const next = noteAssembled({ ...target, data, linkedCurves: curves }, s.datasets); // the watcher need not rebuild it
    useApp.setState((st) => ({
      datasets: st.datasets.map((d) => (d.id === targetId ? next : d)),
      ...(st.activeId === targetId && st.yKeys ? { yKeys: [...st.yKeys, curves.length - 1] } : {}),
      // The auto quantity title follows the new curve; a title the user typed stays.
      ...(st.activeId === targetId && st.yAxisLabel === linkedGraphYTitle(target.linkedCurves ?? [], st.datasets)
        ? { yAxisLabel: linkedGraphYTitle(curves, st.datasets) }
        : {}),
    }));
    watchLinkedCurves();
    toast(`added “${curve.label}” to “${target.name}”`, "ok");
    return;
  }
  const own = drawnCurves(target);
  const graph = landGraph([...own, curve]);
  // The drawn curves keep their styles: re-key them onto the graph's columns.
  const styles = Object.fromEntries(own.flatMap((c, i) => (s.seriesStyles[c.yKey] ? [[i, s.seriesStyles[c.yKey]]] : [])));
  if (Object.keys(styles).length > 0) useApp.setState({ seriesStyles: styles });
  toast(`made a live graph “${graph.name}” with ${own.length + 1} curves`, "ok");
}
