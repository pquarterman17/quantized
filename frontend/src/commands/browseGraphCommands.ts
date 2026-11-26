// Plot > Layout (Browse): step the focused graph's curve through its sheet's columns or
// through same-shaped sheets, pick points, and open the Graph browser window
// (Origin gap plan item 22). Menu and palette only, so registered in the full
// command list (appCommands.ts), not the first-paint core one; the writes load
// on demand (store/browseGraphApply.ts).

import type { Action } from "../store/commands";
import { useAnalysisExtras } from "../store/analysisExtras";
import { useApp } from "../store/useApp";
import { onLoadFailure, runLazy } from "../lib/runLazy";

const step = (by: "column" | "sheet", delta: 1 | -1) => () =>
  void runLazy("Loading graph browsing…", () => import("../store/browseGraphApply")).then((m) => void m.browseGraph(by, delta), onLoadFailure);

const browse = (id: string, label: string, by: "column" | "sheet", delta: 1 | -1, description: string, shortcut: string): Action => ({
  id,
  group: "Plot",
  section: "Layout",
  label,
  description,
  shortcut,
  keywords: "browse graph step toggle through columns sheets slider next previous curve",
  run: step(by, delta),
});

export const browseGraphCommands: Action[] = [
  browse("browse-column-next", "Next column", "column", 1, "Plot the next column of the sheet on the focused graph's first visible curve, keeping its style.", "⌥↓"),
  browse("browse-column-prev", "Previous column", "column", -1, "Plot the previous column of the sheet on the focused graph's first visible curve, keeping its style.", "⌥↑"),
  browse("browse-sheet-next", "Next sheet", "sheet", 1, "Plot the same columns from the next sheet that has them, keeping the curve's style.", "⌥⇧↓"),
  browse("browse-sheet-prev", "Previous sheet", "sheet", -1, "Plot the same columns from the previous sheet that has them, keeping the curve's style.", "⌥⇧↑"),
  {
    id: "pick-points",
    group: "Plot",
    section: "Layout",
    label: "Pick points from the graph",
    description: "Arm the Pick tool: each click collects the nearest data point, ready to become a worksheet with its source rows.",
    keywords: "pick points collect click data reader extract worksheet",
    run: () => {
      useApp.getState().setPlotTool("pick");
      useAnalysisExtras.getState().show("graph-browser");
    },
  },
  {
    id: "graph-browser",
    group: "Plot",
    section: "Layout",
    label: "Graph browser…",
    description: "Step the graph through columns or sheets, collect picked points, scroll an axis or filter to the plotted range.",
    keywords: "browse graph slider scroller axis scrollbar pick points data slicer filter",
    run: () => useAnalysisExtras.getState().show("graph-browser"),
  },
];
