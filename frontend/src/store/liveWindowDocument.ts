// Pure derivation of a PlotWindow's LIVE FigureDocument. Extracted out of
// figureLifecycle.ts (which re-exports it, so every existing importer is
// untouched) into its own dependency-free module so figurePublicationLibrary.ts
// -- the Library Apply staleness/live-drift decision logic, item 1 -- can call
// it too without a figureLifecycle.ts <-> figurePublicationLibrary.ts import
// cycle (figureLifecycle.ts already imports resolveLibraryApply FROM there).

import { displayedWindowTitle, snapshotView, type PlotWindow } from "../lib/plotview";
import { updateFigureDocumentFromPlotView, type FigureDocument } from "../lib/figureDocument";
import type { AppState } from "./useApp";

/** Return the canonical document with the focused facade folded into it.
 *
 *  Item 5: names the focused branch from `displayedWindowTitle` (title ->
 *  bound dataset's name -> "Untitled graph") instead of the window's raw
 *  `title`, the SAME fallback `saveFigure` already applies to a blank
 *  window title -- the default main window is created at store init, before
 *  any dataset exists, so its `title` is the "" sentinel forever. That bare
 *  "" used to leak into a window-target Publication Preview session's name
 *  ("Publication preview — " / "Editing ." in the UI) for a window the user
 *  is plainly looking at with a real displayed title. Only fills the blank
 *  sentinel; an explicit title is returned verbatim. */
export function liveWindowDocument(state: AppState, window: PlotWindow): FigureDocument | null {
  if (window.kind !== "plot" || !window.document) return null;
  return window.id === state.focusedWindowId
    ? updateFigureDocumentFromPlotView(window.document, {
        view: snapshotView(state),
        name: displayedWindowTitle(window, state.datasets),
        datasetId: window.datasetId,
      })
    : structuredClone(window.document);
}
