// A plot window's document keeps the fit curve ITS canvas draws (gap audit 5
// lane C; lib/figureOverlays.ts has the section and its fail-closed row
// check). The fit is WINDOW-SCOPED: the store's one `fitOverlay` slot belongs
// to the focused window. Three moves:
//   * HANDOFF -- when a window takes focus, the slot becomes that window's own
//     saved fit (if its rows still match and the fit is not stale), else
//     empty: another window's fit never spreads onto it. What was put there is
//     remembered as "seeded on this focus".
//   * FOLD -- whenever the focused window's view is committed to its document
//     (store/windowDocuments.commitFocusedWindow: a focus switch, minimize,
//     `windowsForSave`; liveWindowDocument: Save / Save As, Publication
//     Preview, the unsaved-edits check), a fit drawn for its dataset and
//     actually placed on its view replaces the section. The section is
//     REMOVED only when this window showed it on this focus (seeded, or
//     drawn) and the slot is now empty -- the user removed it. Anything else
//     (rows changed, data still loading, the slot holding another dataset's
//     fit, this module arriving after the focus) keeps the section as it is.
//   * RESEED -- when the focused window's lazy book finishes loading, its
//     saved fit is put back (it could not be checked against preview rows).
// Only a LIVE document captures: a frozen one renders its own snapshot.
// LAZY: the eager store reaches it through store/windowOverlaysLazy.ts only.

import type { FigureDocument } from "../lib/figureDocument";
import { figureDocumentToPlotView } from "../lib/figureDocument";
import { captureFit, fitFromDocument, sanitizeFigureOverlays } from "../lib/figureOverlays";
import { overlayLayout, placeOverlay } from "../lib/overlayPlacement";
import { perSeriesXDataset } from "../lib/perSeriesX";
import type { PlotView, PlotWindow } from "../lib/plotview";
import { shownCurves } from "../lib/shownCurves";
import type { Dataset, FitOverlay } from "../lib/types";
import { useApp, type AppState } from "./useApp";
import { withPlotWindowDocument } from "./windowDocuments";

type State = Pick<AppState, "fitOverlay" | "datasets" | "staleFits">;

/** What the focused window showed: set at each handoff this module saw. */
let focus: { windowId: string; shown: FitOverlay | null } | null = null;

/** Is `fit` drawn on `view` of `ds`? The canvas' own placement (I1,
 *  lib/overlayPlacement): its bound Y shown, on its own X's block. */
export function fitPlaced(ds: Dataset, view: PlotView, fit: FitOverlay): boolean {
  const shown = shownCurves(ds.data, view, ds.channelRoles);
  const v = perSeriesXDataset(ds, view.xKey, shown);
  const placed = placeOverlay(fit, overlayLayout(ds, view.xKey, v?.blocks, shown));
  return !!placed && placed.y.length >= (v?.dataset ?? ds).data.time.length;
}

const datasetOf = (doc: FigureDocument | undefined, s: Pick<AppState, "datasets">): Dataset | undefined =>
  doc?.bindings.datasetId ? s.datasets.find((d) => d.id === doc.bindings.datasetId) : undefined;

/** The fit a document puts on the canvas: its own, fresh, not stale. */
function savedFit(doc: FigureDocument | undefined, s: Pick<AppState, "datasets" | "staleFits">): FitOverlay | null {
  if (!doc || doc.data.mode !== "live" || !doc.overlays) return null;
  const ds = datasetOf(doc, s);
  return ds && !s.staleFits.includes(ds.id) ? fitFromDocument(doc.overlays, ds) : null;
}

/** The slot when `target` takes focus (see HANDOFF). */
export function handoff(target: PlotWindow | undefined, s: Pick<AppState, "datasets" | "staleFits">): Partial<AppState> {
  watch();
  if (!target) return {};
  const shown = target.kind === "plot" ? savedFit(target.document, s) : null;
  focus = { windowId: target.id, shown };
  return { fitOverlay: shown };
}

/** `doc` (window `windowId`'s) with the fit its canvas draws folded in. */
export function fold(doc: FigureDocument, s: State, windowId: string): FigureDocument {
  watch();
  if (doc.data.mode !== "live") return doc;
  // A focus this module did not see (the startup window, or one taken before
  // the chunk arrived): nothing was shown from the section, so it is never
  // inferred removed -- only a fit drawn now for its dataset is captured.
  if (focus?.windowId !== windowId) focus = { windowId, shown: null };
  const ds = datasetOf(doc, s);
  const cur = s.fitOverlay;
  if (cur && ds && !ds.pending && cur.datasetId === ds.id) {
    focus.shown = cur;
    const overlays = fitPlaced(ds, figureDocumentToPlotView(doc), cur) ? captureFit(cur, ds) : undefined;
    return overlays ? { ...doc, overlays } : doc; // not placed on this view: the section stands
  }
  if (cur === null && focus.shown && doc.overlays) {
    const { overlays: _removed, ...rest } = doc; // shown on this focus, now removed
    return rest;
  }
  return doc;
}

/** `w` (the focused window, just synced) with its fold applied. */
export function commit(w: PlotWindow, s: AppState): PlotWindow {
  if (w.kind !== "plot" || !w.document) return w;
  const doc = fold(w.document, s, w.id);
  return doc === w.document ? w : withPlotWindowDocument(w, doc);
}

/** After a project loads (store/workspaceHydration): drop unreadable saved fit
 *  sections once (with a notice), put the focused window's own fit back, else
 *  redraw its dataset's saved fit from its parameters (store/overlayRestore.ts,
 *  gap audit 6 lane K). Nothing is written over a fit drawn meanwhile. */
export async function restoreOverlays(): Promise<"seeded" | "drawn" | "refused" | "none"> {
  dropUnreadable();
  const s = useApp.getState();
  if (s.fitOverlay) return "none";
  const target = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  const patch = handoff(target, s);
  if (patch.fitOverlay) {
    useApp.setState(patch);
    return "seeded";
  }
  const result = await (await import("./overlayRestore")).restoreSavedFitOverlay();
  if (result === "drawn" && focus && focus.windowId === target?.id) focus.shown = useApp.getState().fitOverlay;
  return result;
}

function dropUnreadable(): void {
  const s = useApp.getState();
  const bad = (doc: FigureDocument | undefined) => !!doc?.overlays && !sanitizeFigureOverlays(doc.overlays);
  const clean = (doc: FigureDocument): FigureDocument => {
    const { overlays: _bad, ...rest } = doc;
    return rest;
  };
  const windows = s.plotWindows.filter((w) => w.kind === "plot" && bad(w.document));
  const figures = s.editableFigures.filter(bad);
  if (!windows.length && !figures.length) return;
  useApp.setState({
    plotWindows: s.plotWindows.map((w) => (w.kind === "plot" && w.document && bad(w.document) ? withPlotWindowDocument(w, clean(w.document)) : w)),
    editableFigures: s.editableFigures.map((f) => (bad(f) ? clean(f) : f)),
    status: `dropped ${windows.length + figures.length} unreadable saved fit curve(s); their figures are kept`,
  });
}

// RESEED: the focused window's lazy book finished loading. Installed on first
// use (never at import: this chunk can load while the store is still being
// built, during the eager graph's own evaluation).
let watching = false;
function watch(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe(reseed);
}

function reseed(s: AppState, prev: AppState): void {
  if (s.datasets === prev.datasets || s.fitOverlay || !focus || focus.windowId !== s.focusedWindowId) return;
  const w = s.plotWindows.find((x) => x.id === s.focusedWindowId);
  const id = w?.kind === "plot" ? w.document?.bindings.datasetId : null;
  const was = prev.datasets.find((d) => d.id === id);
  const now = s.datasets.find((d) => d.id === id);
  if (!w || !was?.pending || !now || now.pending) return;
  const fit = w.kind === "plot" ? savedFit(w.document, s) : null;
  if (!fit) return;
  focus.shown = fit;
  useApp.setState({ fitOverlay: fit });
}
