// Plot-bound analysis tools open ON the plot they analyse (UX audit 10, P0-1 and
// P0-2). Curve fit, Peaks, Hysteresis and Baseline read the focused plot (their
// "tool-default" capture, store/analysisSelection) and draw on it: fit ranges
// are dragged there and results are overlaid there. Opened over the Worksheet,
// the Analysis Center or a Technique workflow page, or with a Library row
// highlighted that is not the plotted one, they used to analyse data the user
// could not see while the panel said "the data on the current plot".
//
// When one of them opens, this module shows its input first:
//   - the dataset is the tool's reviewed handoff (Analysis Center, worksheet,
//     rerun) when it has one, else the command target (lib/commandTarget: the
//     dataset last pointed at, so a Tree single-click then Curve fit fits the
//     clicked row). A tool PINNED to a dataset keeps its pin and does not
//     rebind the plot; its header says the input is off the plot.
//   - that dataset goes onto the focused plot (`setActive`, the plot-intent
//     primitive; a pinned window hands the rebind on as usual), and
//   - the stage switches to its Plot (or Map) tab.
// The other single-dataset analysis tools (Distribution, Tabulate, Signal
// processing, Reflectivity, Magnetometry tools and the statistics tools) follow
// the same command target: opening one with another row highlighted puts that
// row on the focused plot (`setActive`, whose own stage-tab rule applies).
// Provisional, owner to confirm (UX10-A): opening an analysis tool may now
// change the plotted dataset to the highlighted Library row.
//
// Lazy: imported only by the after-mount panel chunk and the tools' own headers.

import { useAnalysisSelection } from "../store/analysisSelection";
import { useFitModelStore } from "../store/fitModel";
import { useFitYByXStore } from "../store/fitYByX";
import { useMultivarStore } from "../store/multivar";
import { useOutlierScreeningStore } from "../store/outlierScreening";
import { useStatsTestsStore } from "../store/statsTests";
import { useVariabilityStore } from "../store/variability";
import { useApp, type AppState } from "../store/useApp";
import { commandTargetId } from "./commandTarget";
import { plotIntentStageTab } from "./stagetab";
import { pinOf } from "./windowLayout/pins";
import { toolRef } from "./windowLayout/refs";

/** The store flag that opens each plot-bound tool, and the tool's selection id. */
export const PLOT_BOUND_TOOLS = [
  ["curveFitOpen", "curvefit"],
  ["peaksOpen", "peaks"],
  ["hysteresisOpen", "hysteresis"],
  ["baselineOpen", "baseline"],
] as const satisfies readonly (readonly [keyof AppState, string])[];

/** Put `datasetId` on the focused plot and show the Plot (or Map) tab. */
export function showOnPlot(datasetId: string): void {
  const app = useApp.getState();
  const dataset = app.datasets.find((entry) => entry.id === datasetId);
  if (!dataset) return;
  if (app.activeId !== datasetId) app.setActive(datasetId);
  const tab = plotIntentStageTab(dataset);
  if (useApp.getState().stageTab !== tab) useApp.getState().setStageTab(tab);
}

/** The dataset a just-opened plot tool will analyse, and whether to put it on
 *  the plot (false for a pinned tool, which deliberately reads another one). */
export function toolInputTarget(toolId: string): { datasetId: string | null; rebind: boolean } {
  const held = useAnalysisSelection.getState();
  const handoff = held.toolId === toolId && held.selection && held.selection.source !== "tool-default"
    ? held.selection.items[0]?.datasetId ?? null
    : null;
  const app = useApp.getState();
  const pinned = pinOf(app.windowLayout, toolRef(toolId));
  if (pinned && app.datasets.some((d) => d.id === pinned)) return { datasetId: pinned, rebind: false };
  return { datasetId: handoff ?? commandTargetId(app), rebind: true };
}

/** A plot-bound tool just opened: show what it analyses. */
export function revealToolInput(toolId: string): void {
  const { datasetId, rebind } = toolInputTarget(toolId);
  const app = useApp.getState();
  const shown = rebind ? datasetId : app.activeId;
  if (shown) showOnPlot(shown);
}

/** Single-dataset analysis tools that read the focused plot's dataset but do
 *  not draw on the plot: opening one puts the command target on the focused
 *  plot (so the tool, its header and the title bar agree); the stage tab is
 *  left to `setActive`'s own rule. */
export const TARGETING_TOOL_FLAGS = [
  "distributionOpen", "tabulateOpen", "signalProcessingOpen", "reflectivityOpen", "magToolsOpen",
] as const satisfies readonly (keyof AppState)[];

/** The same, for the statistics tools that keep their open flag in their own store. */
const TARGETING_TOOL_STORES: readonly OpenFlagStore[] = [
  useFitYByXStore, useFitModelStore, useOutlierScreeningStore, useMultivarStore, useStatsTestsStore, useVariabilityStore,
];

interface OpenFlagStore {
  subscribe: (listener: (state: { open: boolean }, prev: { open: boolean }) => void) => () => void;
}

/** A single-dataset tool just opened: put the command target on the focused
 *  plot when the Library highlight names another dataset. */
export function targetToolOpened(): void {
  const app = useApp.getState();
  const target = commandTargetId(app);
  if (target && target !== app.activeId) app.setActive(target);
}

/** Watch the tools' open flags; reveal each tool's input as it opens. Returns
 *  the unsubscribe. */
export function watchPlotToolOpens(): () => void {
  const stops = [
    useApp.subscribe((state, prev) => {
      for (const [flag, toolId] of PLOT_BOUND_TOOLS) {
        if (state[flag] && !prev[flag]) revealToolInput(toolId);
      }
      if (TARGETING_TOOL_FLAGS.some((flag) => state[flag] && !prev[flag])) targetToolOpened();
    }),
    ...TARGETING_TOOL_STORES.map((store) => store.subscribe((state, prev) => {
      if (state.open && !prev.open) targetToolOpened();
    })),
  ];
  return () => stops.forEach((stop) => stop());
}
