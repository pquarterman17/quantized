// A plot window's document keeps the analysis overlays its canvas draws
// (gap audit 5, lane C; lib/figureOverlays.ts has the section and its
// fail-closed row check). Two moves, mirroring how the view itself moves
// between "live" (the store's singleton fields) and "at rest" (the document):
//   * FOLD -- whenever the focused window's view is committed to its document
//     (store/windowDocuments.commitFocusedWindow: a focus switch, minimize,
//     `windowsForSave`; liveWindowDocument: Save / Save As, the live
//     document Publication Preview and the unsaved-edits check read), the
//     overlays the canvas draws for its dataset replace the document's section.
//     Removing a fit therefore removes it from the figure on the next commit;
//     a section that could not be on the canvas (stale rows, data still
//     loading, malformed) is kept as it is.
//   * SEED -- when a window takes focus (or a saved figure opens into one, or
//     a project loads), the kinds its document holds are put back on the
//     canvas, if its rows still hash the same. A stale section seeds nothing:
//     it is never drawn on rows it was not computed on.
// Only a LIVE document captures: a frozen one renders its own snapshot, which
// the canvas' overlays were never computed on.
// LAZY: reached through store/windowOverlaysLazy.ts only.

import type { FigureDocument } from "../lib/figureDocument";
import { captureFigureOverlays, liveOverlaysFromDocument } from "../lib/figureOverlays";
import type { PlotWindow } from "../lib/plotview";
import { useApp, type AppState } from "./useApp";

type OverlayState = Pick<AppState, "fitOverlay" | "baselineOverlay" | "peakOverlay" | "datasets">;

/** `document` with its overlay section replaced by what the canvas draws. */
export function foldLiveOverlays(document: FigureDocument, s: OverlayState): FigureDocument {
  if (document.data.mode !== "live") return document;
  const datasetId = document.bindings.datasetId;
  const dataset = datasetId ? s.datasets.find((d) => d.id === datasetId) : undefined;
  const overlays = dataset?.pending ? undefined : captureFigureOverlays(s, datasetId, dataset?.data);
  if (overlays === undefined) {
    // Nothing drawn. A section that COULD have been drawn was removed by the
    // user; one that could not never reached the canvas, so it is kept.
    const drawable = !!dataset && !dataset.pending &&
      Object.keys(liveOverlaysFromDocument(document.overlays, datasetId, dataset.data)).length > 0;
    if (!document.overlays || !drawable) return document;
  }
  const { overlays: _old, ...rest } = document;
  return overlays === undefined ? rest : { ...rest, overlays };
}

/** The store overlays a window's (or figure's) document puts back on the
 *  canvas when it takes focus: only the kinds it holds, only while fresh. */
export function documentOverlaySeed(
  document: FigureDocument | undefined,
  datasets: AppState["datasets"],
): Partial<AppState> {
  if (!document || document.data.mode !== "live" || !document.overlays) return {};
  const datasetId = document.bindings.datasetId;
  const dataset = datasetId ? datasets.find((d) => d.id === datasetId) : undefined;
  return dataset?.pending ? {} : liveOverlaysFromDocument(document.overlays, datasetId, dataset?.data);
}

/** `documentOverlaySeed` for a window about to take focus. */
export function windowOverlaySeed(w: PlotWindow | undefined, s: Pick<AppState, "datasets">): Partial<AppState> {
  return w && w.kind === "plot" ? documentOverlaySeed(w.document, s.datasets) : {};
}

/** After a project loads (store/workspaceHydration): the focused window's own
 *  saved overlays back on its canvas, else its dataset's saved fit redrawn from
 *  its parameters (store/overlayRestore.ts, gap audit 6 lane K). Nothing is
 *  written over an overlay drawn meanwhile. */
export async function restoreOverlays(): Promise<"seeded" | "drawn" | "refused" | "none"> {
  const s = useApp.getState();
  if (s.fitOverlay || s.baselineOverlay || s.peakOverlay) return "none";
  const seed = windowOverlaySeed(s.plotWindows.find((w) => w.id === s.focusedWindowId), s);
  if (Object.keys(seed).length) useApp.setState(seed);
  return seed.fitOverlay ? "seeded" : (await import("./overlayRestore")).restoreSavedFitOverlay();
}
