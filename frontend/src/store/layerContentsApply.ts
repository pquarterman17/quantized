// Apply a Layer Contents draft (lib/layerContents.ts, origin gap audit 3 N1)
// to the graph the focused window shows, as ONE undo step.
//
// A LIVE graph (`linkedCurves`): its removals, moves and inserts run as column
// shifts through the shared column-shift guard (store/columnRemovalRefs.ts),
// so a curve's style, label, hidden state, Y2 placement and error key follow
// the curve -- in the live view, every window bound to the graph, saved
// figures and any graph drawing from this one -- then the curves take their
// draft bindings and the graph is re-assembled from its live sources.
//
// A PLAIN dataset's graph: removing or reordering its own curves edits the
// view (which channels are drawn, and in what order); adding or re-binding a
// curve makes it a live graph of the draft's curves (the window is rebound to
// it; the kept curves keep their styles), exactly as "Add curve" always did.
//
// Loaded on demand (the dialog chunk and the drop-onto-graph gesture).

import { remapDatasetChannels, type ColumnShift } from "../lib/channelRemap";
import { layerRowsChanged, layerRowsProblems, layerShifts, sameBinding, type LayerRow } from "../lib/layerContents";
import { assembleLinkedCurves, curvesForDatasets, linkedGraphReaches, linkedGraphYTitle } from "../lib/linkedCurves";
import { is2DMap } from "../lib/mapdata";
import { primaryChannel } from "../lib/plotdataExtras";
import { UNRESOLVED_SOURCE } from "../lib/linkedCurvesLite";
import { drawnCurves, landGraph } from "../lib/plotSelectedTogetherRun";
import type { Dataset, LinkedCurve } from "../lib/types";
import { columnRemovalRefsPatch } from "./columnRemovalRefs";
import { flushLinkedCurves, noteAssembled, watchLinkedCurves } from "./linkedCurvesSync";
import { resolvePendingEdit } from "./pendingEdit";
import { toast } from "./toasts";
import { useApp, type AppState } from "./useApp";

const PLACEHOLDER: LinkedCurve = { datasetId: UNRESOLVED_SOURCE, xKey: null, yKey: -1, label: "" };

/** The curve list after one column shift (an inserted column is a placeholder
 *  until the draft's bindings land). */
function shiftCurves(curves: readonly LinkedCurve[], shift: ColumnShift): LinkedCurve[] {
  const out = [...curves];
  if (typeof shift === "number") out.splice(shift, 1);
  else if ("inserted" in shift) out.splice(shift.inserted, 0, PLACEHOLDER);
  else out.splice(shift.to, 0, ...out.splice(shift.from, 1));
  return out;
}

/** The focused graph's curves now (the dialog's starting draft). */
export function activeLayerCurves(): LinkedCurve[] {
  const s = useApp.getState();
  return s.activeId ? layerCurvesOf(s, s.activeId) : [];
}

/** The draft's curves for the graph `targetId` shows: what the dialog lists. */
export function layerCurvesOf(s: AppState, targetId: string): LinkedCurve[] {
  const ds = s.datasets.find((d) => d.id === targetId);
  if (!ds) return [];
  return ds.linkedCurves ?? (s.activeId === targetId ? drawnCurves(ds) : []);
}

/** Apply `rows` to the graph `targetId` shows. Returns true when it changed
 *  something; a draft with problems is refused (toast) and changes nothing. */
export function applyLayerContents(targetId: string, rows: readonly LayerRow[]): boolean {
  flushLinkedCurves(); // a mask just set on the graph reaches its sources first
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === targetId);
  if (!target) return false;
  const old = layerCurvesOf(s, targetId);
  if (!layerRowsChanged(old, rows)) return false;
  const problems = layerRowsProblems(old, rows, s.datasets, (id) => !!target.linkedCurves && linkedGraphReaches(s.datasets, id, targetId));
  if (problems.length > 0) {
    toast(`can't change “${target.name}”: ${problems[0]}`, "danger");
    return false;
  }
  if (target.linkedCurves) applyToGraph(target, old, rows);
  else applyToPlain(target, old, rows);
  return true;
}

function applyToGraph(target: Dataset, old: readonly LinkedCurve[], rows: readonly LayerRow[]): void {
  const id = target.id;
  // A live graph is assembled, never a pending book; the guard keeps the rule uniform.
  if (resolvePendingEdit(useApp.getState, target, "editing layer contents", () => applyToGraph(target, old, rows))) return;
  const s0 = useApp.getState();
  s0.recordHistory("edit layer contents");
  const autoTitle = s0.activeId === id && s0.yAxisLabel === linkedGraphYTitle(old, s0.datasets);
  let cur: AppState = s0;
  let out: Partial<AppState> = {};
  for (const shift of layerShifts(old.length, rows)) {
    const ds = cur.datasets.find((d) => d.id === id);
    if (!ds?.linkedCurves) break;
    const linkedCurves = shiftCurves(ds.linkedCurves, shift);
    const next: Dataset = { ...ds, ...remapDatasetChannels(ds, shift), linkedCurves, data: assembleLinkedCurves(linkedCurves, cur.datasets, ds.data) };
    const datasets = cur.datasets.map((d) => (d.id === id ? next : d));
    const patch = { datasets, ...columnRemovalRefsPatch(cur, id, shift, datasets) };
    out = { ...out, ...patch };
    cur = { ...cur, ...patch };
  }
  // The draft's bindings (re-bound and added curves), assembled from the live sources.
  const curves = rows.map((r) => r.curve);
  const ds = cur.datasets.find((d) => d.id === id)!;
  // The mask lives on the source points (lib/linkedCurves.linkedGraphMask), so it follows every curve.
  const graph = noteAssembled({ ...ds, linkedCurves: curves, data: assembleLinkedCurves(curves, cur.datasets, ds.data) }, cur.datasets);
  const datasets = cur.datasets.map((d) => (d.id === id ? graph : d));
  // An added curve is drawn: a view that names its curves gains it.
  const added = rows.flatMap((r, i) => (r.from === null ? [i] : []));
  const withAdded = (keys: number[] | null): number[] | null => (keys === null ? null : [...keys, ...added]);
  const plotWindows = (out.plotWindows ?? cur.plotWindows).map((w) =>
    w.datasetId === id && w.view.yKeys !== null ? { ...w, view: { ...w.view, yKeys: withAdded(w.view.yKeys) } } : w,
  );
  useApp.setState({
    ...out,
    datasets,
    plotWindows,
    ...(cur.activeId === id ? { yKeys: withAdded(cur.yKeys) } : {}),
    ...(autoTitle ? { yAxisLabel: linkedGraphYTitle(curves, datasets) } : {}),
  });
  watchLinkedCurves();
  toast(`updated “${target.name}”: ${curves.length} curve${curves.length === 1 ? "" : "s"} — Undo restores the previous layer`, "ok");
}

function applyToPlain(target: Dataset, old: readonly LinkedCurve[], rows: readonly LayerRow[]): void {
  const s = useApp.getState();
  const ownOnly = rows.every((r) => r.from !== null && sameBinding(r.curve, old[r.from]));
  if (ownOnly) {
    // Remove / reorder the dataset's own curves: which channels are drawn, in order.
    s.recordHistory("edit layer contents");
    const keys = rows.map((r) => r.curve.yKey);
    const hidden = s.hiddenChannels.filter((c) => !keys.includes(c));
    useApp.setState({ yKeys: [...keys, ...hidden], seriesOrder: [...keys, ...hidden] });
    toast(`updated “${target.name}”: ${keys.length} curve${keys.length === 1 ? "" : "s"}`, "ok");
    return;
  }
  const graph = landGraph(rows.map((r) => r.curve));
  // The kept curves keep their styles: re-keyed onto the graph's columns.
  const styles = Object.fromEntries(
    rows.flatMap((r, i) => {
      const style = r.from === null ? undefined : s.seriesStyles[old[r.from].yKey];
      return style ? [[i, style]] : [];
    }),
  );
  if (Object.keys(styles).length > 0) useApp.setState({ seriesStyles: styles });
  toast(`made a live graph “${graph.name}” with ${rows.length} curves`, "ok");
}

/** Drag a dataset (or a book: every sheet in it) from the Library onto a
 *  graph: its Y columns — the designated Y columns, each on its own X, else
 *  its primary channel — join the graph as linked curves (one undo step). */
export async function addDatasetsToGraph(targetId: string, ids: readonly string[]): Promise<boolean> {
  let sources: Dataset[];
  try {
    sources = await useApp.getState().resolveDatasets([...ids]);
  } catch (e) {
    toast(`couldn't load the dropped data — ${e instanceof Error ? e.message : "error"}`, "danger");
    return false;
  }
  const target = useApp.getState().datasets.find((d) => d.id === targetId);
  const usable = sources.filter((d) => !is2DMap(d.data) && d.id !== targetId);
  const curves = curvesForDatasets(usable, (d) => primaryChannel(d.data));
  if (!target || curves.length === 0) {
    toast(target ? "nothing to plot from the dropped data (a map, or the graph itself)" : "that graph is gone", "danger");
    return false;
  }
  return appendCurvesTo(targetId, curves);
}

/** A Library drop (a book, else one dataset) onto the graph `targetId` shows. */
export function addDroppedToGraph(targetId: string, dropped: { book: string; dataset: string }): Promise<boolean> {
  const ids = dropped.book
    ? useApp.getState().datasets.filter((d) => d.workbookId === dropped.book).map((d) => d.id)
    : [dropped.dataset];
  return addDatasetsToGraph(targetId, ids);
}

/** Append `curves` to the graph `targetId` shows (one undo step). */
export function appendCurvesTo(targetId: string, curves: readonly LinkedCurve[]): boolean {
  const s = useApp.getState();
  const old = layerCurvesOf(s, targetId);
  return applyLayerContents(targetId, [...old.map((curve, from) => ({ curve, from })), ...curves.map((curve) => ({ curve, from: null }))]);
}
