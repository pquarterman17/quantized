// Library discoverability: "Plot in new window" — the shared action behind
// the Library dataset row's context menu (lib/contextActions.ts's
// `dataset.plotInNewWindow`) and the ⌘K palette command
// (commands/plotCommands.ts's `plot-in-new-window`), same shape as
// lib/plotSelectedTogether.ts (one implementation, several surfaces). A
// plain Library click REBINDS the focused window (unless pinned) — there
// was no direct "plot this dataset in a NEW window" gesture, so users could
// only discover multiple windows via Graph Builder's "Create New Plot". This
// calls the SAME createWindow + focusWindow pair (store/windows.ts) Graph
// Builder's `commitToPlot("new")` does (useGraphBuilder.ts), including its
// belt-and-braces `setActive` guard and the owner-routing "surface the Plot
// tab" rule.
//
// Lives outside store/windows.ts deliberately: that module sits AT its
// architecture.test.ts size-ratchet pin with zero headroom (see the pin's
// history comment) — this command needs no new persistent state, only the
// store's existing createWindow/focusWindow/setActive/recordMacro actions.

import { useApp } from "../store/useApp";
import { lit } from "./macro";
import { plotIntentStageTab } from "./stagetab";

/** Open `datasetId` in a brand-new plot window and focus it — always a
 *  FRESH window, so the same dataset can be viewed several ways side by
 *  side. Returns the new window's id. Records a macro step (like the
 *  sibling `openFigureDocInWindow`). */
export function plotInNewWindow(datasetId: string): string {
  const app = useApp.getState();
  const id = app.createWindow(datasetId);
  app.focusWindow(id);
  // Belt-and-braces: focusWindow's own _focusHandoff already sets activeId
  // to this window's binding, so this is normally a no-op — kept for the
  // same edge case commitToPlot guards against (a dataset not yet fully
  // activated).
  if (useApp.getState().activeId !== datasetId) useApp.getState().setActive(datasetId);
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (ds) {
    // Owner-routing item 1: "plot this" always means look at the plot,
    // regardless of which tab was showing (same rule commitToPlot and
    // openFigureDocInWindow apply).
    const wantTab = plotIntentStageTab(ds);
    if (useApp.getState().stageTab !== wantTab) useApp.getState().setStageTab(wantTab);
  }
  useApp.getState().recordMacro(
    `Plot "${ds?.name ?? datasetId}" in new window`,
    `qz.plotInNewWindow(${lit(datasetId)})`,
  );
  return id;
}
