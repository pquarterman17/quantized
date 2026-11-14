// "Add curve from…" (gap audit 2 #1; Plot › Layout and the command palette):
// add one curve from any dataset to the active LIVE graph (lib/linkedCurves.ts)
// -- Origin's "add plot to layer". When the active dataset is not a graph
// yet, the curves its plot shows now become a new graph ("Graph1, …") with
// the picked curve added, so the result is live either way.
//
// Refuses a source whose curves reach the target (transitively, the target
// itself included): a graph-of-graphs cycle would make the rebuild recurse
// (review finding 1). Two steps through the ordinary parameter dialog: the
// source, then its Y column and X (its own X by default). Loaded on demand.

import { installLinkedCurvesSync } from "../store/linkedCurvesSync";
import { askParams } from "../store/paramDialog";
import { toast } from "../store/toasts";
import { nextDatasetId, useApp } from "../store/useApp";
import { channelLetter } from "./formula";
import { assembleLinkedCurves, nextGraphName, reachesGraph, type LinkedCurve } from "./linkedCurves";
import { is2DMap } from "./mapdata";
import { curveXKey } from "./ownXSeries";
import { effectiveChannels } from "./plotdata";
import type { Dataset } from "./types";

const OWN_X = "its own X";

/** The curves the active plot of `ds` shows now, each on the X it is drawn on. */
function shownCurves(ds: Dataset): LinkedCurve[] {
  const s = useApp.getState();
  return effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder)
    .filter((c) => !s.hiddenChannels.includes(c))
    .map((c) => {
      const x = curveXKey(ds, s.xKey, c);
      return { datasetId: ds.id, xKey: x === curveXKey(ds, null, c) ? null : x, yKey: c };
    });
}

/** Ask for a curve and add it to the active graph (or a new one). */
export async function addCurveFrom(): Promise<void> {
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === s.activeId) ?? null;
  const graph = target?.linkedCurves ? target : null;
  const sources = s.datasets.filter((d) => !is2DMap(d.data) && !(graph && reachesGraph(d.id, graph.id, s.datasets)));
  if (sources.length === 0) {
    toast("no dataset can add a curve here — a graph cannot plot itself or a graph built from it", "danger");
    return;
  }
  const names = sources.map((d, i) => `${i + 1}: ${d.name}`);
  const picked = await askParams("Add curve from…", [
    { key: "source", label: "Source dataset", type: "select", default: names[0], options: names },
  ], {
    message: graph
      ? `Add a curve to ${graph.name}. It stays linked: editing the source updates the graph.`
      : "Start a live graph from this plot and add a curve to it. It stays linked: editing a source updates the graph.",
    confirmLabel: "Next",
  });
  if (!picked) return;
  const chosen = sources[names.indexOf(String(picked.source))];
  if (!chosen) return;
  const [source] = await useApp.getState().resolveDatasets([chosen.id]);
  if (!source) return;
  const cols = source.data.labels.map((label, c) => `${channelLetter(c)}: ${label}`);
  if (cols.length === 0) {
    toast(`${source.name} has no columns to plot`, "danger");
    return;
  }
  const xName = String(source.data.metadata?.["x_column_long"] || source.data.metadata?.["x_column_name"] || "x");
  const xOptions = [OWN_X, `X: ${xName}`, ...cols];
  const pickYX = await askParams(`Add curve from ${source.name}`, [
    { key: "y", label: "Y column", type: "select", default: cols[0], options: cols },
    { key: "x", label: "X", type: "select", default: OWN_X, options: xOptions },
  ], { message: "Its own X is the X column it belongs to in its sheet (Origin's nearest X before it).", confirmLabel: "Add curve" });
  if (!pickYX) return;
  const yKey = cols.indexOf(String(pickYX.y));
  const xPick = xOptions.indexOf(String(pickYX.x));
  if (yKey < 0) return;
  const curve: LinkedCurve = { datasetId: source.id, xKey: xPick >= 2 ? xPick - 2 : null, yKey };
  if (xPick === 1) {
    // The sheet's own first X (.time) chosen explicitly: own X when that IS its X.
    if (curveXKey(source, null, yKey) !== null) {
      toast(`"${source.data.labels[yKey]}" belongs to another X column; pick it, or "${OWN_X}"`, "danger");
      return;
    }
  }
  commitCurve(graph?.id ?? null, target, curve);
}

/** Land `curve` on graph `graphId` (re-checked against the CURRENT store), or
 *  start a new graph seeded from `seed`'s shown curves. */
export function commitCurve(graphId: string | null, seed: Dataset | null, curve: LinkedCurve): boolean {
  const app = useApp.getState();
  if (graphId) {
    const graph = app.datasets.find((d) => d.id === graphId);
    if (!graph?.linkedCurves) return false;
    if (reachesGraph(curve.datasetId, graphId, app.datasets)) {
      toast(`can't add that curve: ${graph.name} would plot itself (a graph cycle)`, "danger");
      return false;
    }
    app.recordHistory("add curve");
    useApp.setState((st) => ({
      datasets: st.datasets.map((d) => (d.id === graphId ? { ...d, linkedCurves: [...d.linkedCurves!, curve] } : d)),
    }));
    installLinkedCurvesSync();
    app.setStatus(`added a curve to ${graph.name}`);
    return true;
  }
  const curves = [...(seed ? shownCurves(seed) : []), curve];
  const byId = new Map(app.datasets.map((d) => [d.id, d]));
  const created: Dataset = {
    id: nextDatasetId(),
    name: nextGraphName(app.datasets),
    data: assembleLinkedCurves(curves, (id) => byId.get(id)),
    linkedCurves: curves,
  };
  app.addDataset(created);
  installLinkedCurvesSync();
  toast(`${created.name}: a live graph of ${curves.length} curve${curves.length === 1 ? "" : "s"}`, "ok");
  return true;
}
