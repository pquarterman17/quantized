// A plot window's document keeps the fit ITS canvas draws (gap audit 5 lane C;
// lib/figureOverlays.ts has the section and its fail-closed rows key). The
// fit slot is WINDOW-SCOPED: the store's one `fitOverlay` slot (and, with a
// Peak Analyzer model fit, its fitted background in `baselineOverlay`) belongs
// to the focused window. Moves:
//   * HANDOFF -- when a window takes focus, or a history restore lands on one
//     (store/historySnapshot), the slot becomes that window's own saved fit (if
//     its rows key still matches and the fit is not stale), else empty: another
//     window's fit never spreads onto it. What was put there is remembered as
//     "shown on this focus".
//   * FOLD -- whenever the focused window's view is committed to its document
//     (store/windowDocuments.commitFocusedWindow: a focus switch, minimize,
//     `windowsForSave`, a history snapshot; liveWindowDocument: Save / Save As,
//     Publication Preview, the unsaved-edits check), a fit THIS window drew for
//     its dataset and placed on its view replaces the section, keyed with the
//     rows it was DRAWN on (review N7: a row-state change since never certifies
//     the old curve as current). The section is REMOVED only when this window
//     showed it on this focus, the slot is now empty, and the section still
//     matches its rows (review N3) -- the user removed it. Anything else (rows
//     edited, data loading, another dataset's or another window's fit in the
//     slot, a focus this module did not see) keeps the section as it is.
//   * RESEED -- when the focused window's lazy book finishes loading, its saved
//     fit is put back (it could not be checked against preview rows).
// Who drew a curve is recorded as it lands in the slot, so the Curve Fit
// panel's retained curve never re-spreads onto another window (review N4).
// Only a LIVE document captures: a frozen one renders its own snapshot.
// LAZY: the eager store reaches it through store/windowOverlaysLazy.ts only.

import type { FigureDocument } from "../lib/figureDocument";
import { figureDocumentToPlotView } from "../lib/figureDocument";
import { backgroundFromDocument, captureFit, fitFromDocument, overlayRowsKey, sanitizeFigureOverlays } from "../lib/figureOverlays";
import { overlayLayout, placeOverlay } from "../lib/overlayPlacement";
import { perSeriesXDataset } from "../lib/perSeriesX";
import type { PlotView, PlotWindow } from "../lib/plotview";
import { shownCurves } from "../lib/shownCurves";
import type { BaselineOverlay, Dataset, FitOverlay } from "../lib/types";
import { useApp, type AppState } from "./useApp";
import { withPlotWindowDocument } from "./windowDocuments";
import { clearMissedHandoff, missedHandoff } from "./windowOverlaysLazy";

type State = Pick<AppState, "fitOverlay" | "baselineOverlay" | "datasets" | "staleFits">;

/** What the focused window showed on this focus. `foreign`: the slot may hold
 *  a fit drawn before this module saw the focus (L5) -- never captured. */
let focus: { windowId: string; shown: FitOverlay | null; foreign: boolean } | null = null;
/** The window each curve was drawn in, and the rows key it was drawn on. */
let owner = new WeakMap<object, string>();
let drawnKey = new WeakMap<object, string>();

/** Test isolation (review L6): forget the focus record and the ownership maps. */
export function resetWindowOverlaysForTests(): void {
  focus = null;
  owner = new WeakMap();
  drawnKey = new WeakMap();
}

/** Is `fit` drawn on `view` of `ds`? The canvas' own placement (I1,
 *  lib/overlayPlacement): its bound Y shown, on its own X's block. */
export function fitPlaced(ds: Dataset, view: PlotView, fit: FitOverlay): boolean {
  const shown = shownCurves(ds.data, view, ds.channelRoles);
  const v = perSeriesXDataset(ds, view.xKey, shown);
  const placed = placeOverlay(fit, overlayLayout(ds, view.xKey, v?.blocks, shown));
  return !!placed && placed.y.length >= (v?.dataset ?? ds).data.time.length;
}

/** `section` if its fit is placed on `view` of `ds` (Build source figure, L3). */
export function placedSection<T>(section: T, ds: Dataset, view: PlotView): T | undefined {
  const fit = fitFromDocument(section, ds);
  return fit && fitPlaced(ds, view, fit) ? section : undefined;
}

/** May the focused window draw `fit`? Not when another window drew it (N4). */
export function mayDraw(windowId: string | null, fit: FitOverlay): boolean {
  const who = owner.get(fit);
  return who === undefined || who === windowId;
}

const datasetOf = (doc: FigureDocument | undefined, s: Pick<AppState, "datasets">): Dataset | undefined =>
  doc?.bindings.datasetId ? s.datasets.find((d) => d.id === doc.bindings.datasetId) : undefined;

/** The fit (and fitted background) a document puts on the canvas: its own,
 *  fresh, not stale. */
function saved(doc: FigureDocument | undefined, s: Pick<AppState, "datasets" | "staleFits">): { fit: FitOverlay | null; bg: BaselineOverlay | null } {
  if (!doc || doc.data.mode !== "live" || !doc.overlays) return { fit: null, bg: null };
  const ds = datasetOf(doc, s);
  const fit = ds && !s.staleFits.includes(ds.id) ? fitFromDocument(doc.overlays, ds) : null;
  return { fit, bg: backgroundFromDocument(doc.overlays, ds, fit) };
}

function claim(windowId: string, curve: object, key: string): void {
  owner.set(curve, windowId);
  if (!drawnKey.has(curve)) drawnKey.set(curve, key);
}

/** The slot when `target` takes focus (see HANDOFF). An estimated-baseline
 *  preview in `baselineOverlay` is left alone; a fitted background follows
 *  its fit. */
export function handoff(
  target: PlotWindow | undefined,
  s: Pick<AppState, "datasets" | "staleFits" | "baselineOverlay">,
): Partial<AppState> {
  watch();
  if (!target) return {};
  clearMissedHandoff();
  const { fit, bg } = target.kind === "plot" ? saved(target.document, s) : { fit: null, bg: null };
  const key = target.kind === "plot" && target.document?.overlays ? target.document.overlays.rows : "";
  if (fit) claim(target.id, fit, key);
  if (bg) claim(target.id, bg, key);
  focus = { windowId: target.id, shown: fit, foreign: false };
  return {
    fitOverlay: fit,
    ...(bg ? { baselineOverlay: bg } : s.baselineOverlay?.fitOf ? { baselineOverlay: null } : {}),
  };
}

/** `doc` (window `windowId`'s) with the fit its canvas draws folded in.
 *  `record` false (a history snapshot) folds without touching the focus record. */
export function fold(doc: FigureDocument, s: State, windowId: string, record = true): FigureDocument {
  watch();
  if (doc.data.mode !== "live") return doc;
  // A focus this module did not see (the startup window, or one taken before
  // the chunk arrived): nothing was shown from the section, so it is never
  // inferred removed; and if a handoff was skipped, the slot may hold another
  // window's fit, so nothing is captured either (L5).
  let f = focus;
  if (f?.windowId !== windowId) {
    f = { windowId, shown: null, foreign: missedHandoff() };
    if (record) focus = f;
  }
  const ds = datasetOf(doc, s);
  const cur = s.fitOverlay;
  if (cur && ds && !ds.pending && cur.datasetId === ds.id && !f.foreign && mayDraw(windowId, cur)) {
    if (record) f.shown = cur;
    if (!fitPlaced(ds, figureDocumentToPlotView(doc), cur)) return doc; // not on this view: the section stands
    const overlays = captureFit(cur, ds, drawnKey.get(cur) ?? overlayRowsKey(ds), s.baselineOverlay);
    return overlays ? { ...doc, overlays } : doc;
  }
  if (cur === null && f.shown && doc.overlays && fitFromDocument(doc.overlays, ds)) {
    const { overlays: _removed, ...rest } = doc; // shown on this focus, rows unchanged, now removed
    return rest;
  }
  return doc;
}

/** `w` (the focused window, just synced) with its fold applied. */
export function commit(w: PlotWindow, s: AppState, record = true): PlotWindow {
  if (w.kind !== "plot" || !w.document) return w;
  const doc = fold(w.document, s, w.id, record);
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

// Installed on first use (never at import: this chunk can load while the
// store is still being built, during the eager graph's own evaluation).
let watching = false;
export function watch(): void {
  if (watching) return;
  try {
    useApp.subscribe(onChange);
    watching = true;
  } catch {
    // The store is still being built (this chunk loaded during its graph's
    // evaluation): the next handoff / fold installs it.
  }
}

function onChange(s: AppState, prev: AppState): void {
  // OWNERSHIP: a curve landing in the slot was drawn by the focused window,
  // on the rows its dataset has now.
  const w = s.plotWindows.find((x) => x.id === s.focusedWindowId);
  for (const curve of [s.fitOverlay, s.baselineOverlay?.fitOf ? s.baselineOverlay : null]) {
    if (!curve || owner.has(curve) || !s.focusedWindowId) continue;
    if (focus?.windowId === s.focusedWindowId && focus.foreign) continue;
    const ds = s.datasets.find((d) => d.id === curve.datasetId);
    if (ds && !ds.pending) claim(s.focusedWindowId, curve, overlayRowsKey(ds));
  }
  // RESEED: the focused window's lazy book finished loading.
  if (s.datasets === prev.datasets || s.fitOverlay || !focus || focus.windowId !== s.focusedWindowId) return;
  const id = w?.kind === "plot" ? w.document?.bindings.datasetId : null;
  const was = prev.datasets.find((d) => d.id === id);
  const now = s.datasets.find((d) => d.id === id);
  if (!w || !was?.pending || !now || now.pending) return;
  const patch = handoff(w, s);
  if (patch.fitOverlay) useApp.setState(patch);
}
