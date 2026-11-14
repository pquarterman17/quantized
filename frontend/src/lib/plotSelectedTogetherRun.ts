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
// "Add curve from…" (`addCurveFrom` below) adds a curve from any dataset to
// the focused graph the same way.
//
// Loaded on demand through the eager shim lib/plotSelectedTogether.ts.

import { askParams } from "../store/paramDialog";
import { noteAssembled, watchLinkedCurves } from "../store/linkedCurvesSync";
import { toast } from "../store/toasts";
import { nextDatasetId, useApp } from "../store/useApp";
import { assembleLinkedCurves, curvesFor, linkedGraphYTitle } from "./linkedCurves";
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

/** Add the live graph over `curves` as a new Library dataset and plot it. */
function landGraph(name: string, curves: LinkedCurve[]): Dataset {
  const datasets = useApp.getState().datasets;
  const graph: Dataset = { id: nextDatasetId(), name, data: assembleLinkedCurves(curves, datasets), linkedCurves: curves };
  noteAssembled(graph, datasets);
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
  const curves = curvesFor(plottable, (ds) => primaryChannel(ds.data));
  if (curves.length < MIN_SELECTION) {
    toast("couldn't build an overlay from the selected datasets", "danger");
    return;
  }
  landGraph(`overlay (${curves.length})`, curves);
  toast(`plotted ${curves.length} datasets together — the graph follows its sources${mapSkipNote(maps)}`, "ok");
}

/** Unique option labels for `items` ("name", then "name (2)" for a repeat). */
function optionLabels(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n} (${k})`;
  });
}

const X_OWN = "(its own X)";

/** "Add curve from…": pick a dataset, then its X and Y, and add that curve to
 *  the FOCUSED graph. A live graph gains a curve; a plain dataset's graph
 *  becomes a live graph of its drawn curves plus the new one (the window is
 *  rebound to it; renames and styles follow their curves). */
export async function addCurveFrom(): Promise<void> {
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === s.activeId);
  if (!target) {
    toast("open a graph first, then add a curve to it", "danger");
    return;
  }
  const sources = s.datasets.filter((d) => !is2DMap(d.data) && d.id !== target.id);
  if (sources.length === 0) {
    toast("no other dataset to take a curve from", "danger");
    return;
  }
  const dsLabels = optionLabels(sources.map((d) => d.name));
  const first = await askParams(
    `Add curve to “${target.name}”`,
    [{ key: "dataset", label: "From dataset", type: "select", default: dsLabels[0], options: dsLabels }],
    { confirmLabel: "Next" },
  );
  if (!first) return;
  let source = sources[dsLabels.indexOf(String(first.dataset))];
  if (!source) return;
  try {
    source = (await useApp.getState().resolveDatasets([source.id]))[0] ?? source;
  } catch (e) {
    toast(`couldn't load “${source.name}” — ${e instanceof Error ? e.message : "error"}`, "danger");
    return;
  }
  const cols = optionLabels(source.data.labels.map((l, i) => l || `col ${i + 1}`));
  const yDefault = primaryChannel(source.data) ?? 0;
  const pick = await askParams(
    `Add curve from “${source.name}”`,
    [
      { key: "x", label: "X", type: "select", default: X_OWN, options: [X_OWN, ...cols] },
      { key: "y", label: "Y", type: "select", default: cols[yDefault] ?? cols[0], options: cols },
    ],
    { confirmLabel: "Add curve" },
  );
  if (!pick) return;
  const yKey = cols.indexOf(String(pick.y));
  const xKey = String(pick.x) === X_OWN ? null : cols.indexOf(String(pick.x));
  if (yKey < 0 || (xKey !== null && xKey < 0)) return;
  appendCurve(target.id, { datasetId: source.id, xKey, yKey, label: `${source.name}: ${cols[yKey]}` });
}

/** The curves a plain dataset's FOCUSED graph draws now, each against the X
 *  it is drawn on (its own X column on a multi-X sheet, lib/perSeriesX.ts). */
function drawnCurves(ds: Dataset): LinkedCurve[] {
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

/** Add `curve` to the graph `targetId` shows (see `addCurveFrom`). */
export function appendCurve(targetId: string, curve: LinkedCurve): void {
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === targetId);
  if (!target) return;
  if (target.linkedCurves) {
    s.recordHistory("add curve");
    const curves = [...target.linkedCurves, curve];
    const data = assembleLinkedCurves(curves, s.datasets);
    const next = { ...target, data, linkedCurves: curves };
    noteAssembled(next, s.datasets); // assembled from these sources: the watcher need not rebuild it
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
  const graph = landGraph(`${target.name} + ${curve.label}`, [...own, curve]);
  // The drawn curves keep their styles: re-key them onto the graph's columns.
  const styles = Object.fromEntries(own.flatMap((c, i) => (s.seriesStyles[c.yKey] ? [[i, s.seriesStyles[c.yKey]]] : [])));
  if (Object.keys(styles).length > 0) useApp.setState({ seriesStyles: styles });
  toast(`made a live graph “${graph.name}” with ${own.length + 1} curves`, "ok");
}
