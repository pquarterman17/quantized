// Apply a graph template or Paste Format to MANY graphs at once (gap-audit-2
// #13) -- Origin's Theme Organizer "apply to all graphs in the folder or the
// selection". A "graph" is an open plot window; the focused one is restyled
// through the live store fields, every other one through its own saved view
// (`syncPlotWindow`, as `store/windowViewEdit.ts` does for one). All of it is
// ONE undo step: one `recordHistory`, then one `setState` (the history
// snapshot carries `plotWindows`). Loaded on demand with the template
// commands (`lib/graphTemplateCommands.ts`).

import type { StoreGet } from "./exportActive";
import { graphFormatPatch, type GraphFormat } from "./graphFormat";
import { effectiveChannels } from "./plotdata";
import type { PlotView, PlotWindow } from "./plotview";
import { plotWindowDatasetId, plotWindowView, syncPlotWindow } from "../store/windowDocuments";
import { useApp } from "../store/useApp";

/** Which graphs: those whose data sits in the focused graph's folder, those
 *  the Library selection names (selected worksheets, a selected folder or a
 *  selected graph), or every open graph. */
export type GraphScope = "folder" | "selection" | "all";

export const GRAPH_SCOPES: { value: GraphScope; label: string }[] = [
  { value: "folder", label: "All graphs in this graph's folder" },
  { value: "selection", label: "Graphs of the Library selection" },
  { value: "all", label: "All open graphs" },
];

interface Target {
  window: PlotWindow;
  focused: boolean;
  view: PlotView;
  plotted: number[];
}

type State = ReturnType<StoreGet>;

function plottedOf(state: State, view: PlotView, datasetId: string | null): number[] | null {
  const dataset = state.datasets.find((d) => d.id === datasetId);
  if (!dataset) return null;
  return effectiveChannels(dataset.data, view.yKeys, view.xKey, dataset.channelRoles, view.seriesOrder)
    .filter((ch) => !view.y2Keys?.includes(ch))
    .concat(view.y2Keys ?? []);
}

/** The graphs `scope` names, focused one first. */
export function graphTargets(state: State, scope: GraphScope): Target[] {
  const folderOf = new Map(state.datasets.map((d) => [d.id, d.folderId ?? null]));
  const focusedWin = state.plotWindows.find((w) => w.id === state.focusedWindowId);
  const here = focusedWin ? folderOf.get(plotWindowDatasetId(focusedWin) ?? "") : undefined;
  const sel = state.librarySelection;
  const selected = new Set(state.selectedIds);
  const wanted = (w: PlotWindow, datasetId: string | null): boolean => {
    if (scope === "all") return true;
    if (datasetId === null) return false;
    if (scope === "folder") return here !== undefined && folderOf.get(datasetId) === here;
    if (sel?.kind === "folder") return folderOf.get(datasetId) === sel.id;
    if (sel?.kind === "editable-figure") return w.document?.id === sel.id;
    return selected.has(datasetId);
  };
  const out: Target[] = [];
  for (const w of state.plotWindows) {
    if (w.kind !== "plot") continue;
    const focused = w.id === state.focusedWindowId;
    const datasetId = focused ? state.activeId : plotWindowDatasetId(w);
    if (!wanted(w, datasetId)) continue;
    const view = focused ? (state as unknown as PlotView) : plotWindowView(w);
    const plotted = plottedOf(state, view, datasetId);
    if (plotted) out.push({ window: w, focused, view, plotted });
  }
  return out.sort((a, b) => Number(b.focused) - Number(a.focused));
}

/** Restyle every graph `scope` names with the format `formatFor` gives it,
 *  as ONE undo step labelled `label`. Returns how many graphs changed. */
export function applyFormatToGraphs(
  s: StoreGet,
  scope: GraphScope,
  formatFor: (view: PlotView, plotted: readonly number[]) => GraphFormat,
  label: string,
): number {
  const state = s();
  const targets = graphTargets(state, scope);
  if (targets.length === 0) return 0;
  state.recordHistory(label.toLowerCase());
  const patches = new Map(targets.map((t) => [t.window.id, graphFormatPatch(formatFor(t.view, t.plotted), t.plotted, t.view.seriesStyles, t.view)]));
  const live = targets.find((t) => t.focused);
  useApp.setState((st) => ({
    ...(live ? patches.get(live.window.id) : {}),
    plotWindows: st.plotWindows.map((w) => {
      const patch = patches.get(w.id);
      return patch && w.id !== st.focusedWindowId ? syncPlotWindow(w, { ...plotWindowView(w), ...patch }) : w;
    }),
  }));
  return targets.length;
}
