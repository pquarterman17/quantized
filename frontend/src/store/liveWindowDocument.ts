// Pure derivation of a PlotWindow's LIVE FigureDocument. Extracted out of
// figureLifecycle.ts (which re-exports it, so every existing importer is
// untouched) into its own dependency-free module so figurePublicationLibrary.ts
// -- the Library Apply staleness/live-drift decision logic, item 1 -- can call
// it too without a figureLifecycle.ts <-> figurePublicationLibrary.ts import
// cycle (figureLifecycle.ts already imports resolveLibraryApply FROM there).

import { snapshotView, type PlotWindow } from "../lib/plotview";
import { updateFigureDocumentFromPlotView, type FigureDocument } from "../lib/figureDocument";
import type { AppState } from "./useApp";

/** Return the canonical document with the focused facade folded into it. */
export function liveWindowDocument(state: AppState, window: PlotWindow): FigureDocument | null {
  if (window.kind !== "plot" || !window.document) return null;
  return window.id === state.focusedWindowId
    ? updateFigureDocumentFromPlotView(window.document, {
        view: snapshotView(state),
        name: window.title,
        datasetId: window.datasetId,
      })
    : structuredClone(window.document);
}
