// The two "unsaved edits?" predicates behind the editable-figure close
// confirm and the Publication Preview discard confirm. Moved verbatim out of
// store/figureLifecycle.ts in bundle diet slice 24: only the lazy window
// chrome (components/windows/figureLifecycleUi.ts) calls them, so they ship
// with it instead of in the eager bundle. Import them by this path;
// figureLifecycle.ts does not re-export them (architecture.test.ts,
// DRAGGED_OUT).
import { canonicalJson } from "../lib/canonicalJson";
import type { PlotWindow } from "../lib/plotview";
import type { FigurePublicationSession } from "./figureLifecycle";
import { liveWindowDocument } from "./liveWindowDocument";
import type { AppState } from "./useApp";
import { windowHasUserEdits } from "./windowUserEdits";

/** True only when a SAVED editable figure has drifted from the window's live
 *  state. Distinct from `editableFigureDirty` (which is also true for a
 *  window never saved as a figure — the titlebar ● indicator's meaning):
 *  this gate is for the opted-in saved-figure case. A never-saved window
 *  confirms only when the user styled it (`styledWindowCloseNeedsConfirm`,
 *  below — the figures audit found the convention "undoable actions don't
 *  confirm" (GUI_INTERACTION #17) lost real work there, since few users reach
 *  for Undo after closing a window); a default window closes plainly. */
export function editableFigureHasUnsavedEdits(state: AppState, window: PlotWindow): boolean {
  if (window.kind !== "plot" || !window.document) return false;
  const saved = state.editableFigures.find((document) => document.id === window.document?.id);
  if (!saved) return false;
  const current = liveWindowDocument(state, window);
  return current !== null && JSON.stringify(saved) !== JSON.stringify(current);
}

/** `value` without `undefined` members and empty plain objects, recursively. */
function pruned(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruned);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    const p = pruned(member);
    const emptyObject = p !== null && typeof p === "object" && !Array.isArray(p) && Object.keys(p).length === 0;
    if (p !== undefined && !emptyObject) out[key] = p;
  }
  return out;
}

/** True when two figure documents differ in substance. Key order, an
 *  `undefined` member and an empty override group are not differences:
 *  setting a field and setting it back left `{ legend: {} }` or a reordered
 *  key behind, and Cancel then asked "Discard?" about an edit that changed
 *  nothing (figures audit #16). */
export function figureDocumentsDiffer(a: unknown, b: unknown): boolean {
  return canonicalJson(pruned(a)) !== canonicalJson(pruned(b));
}

export function figurePublicationDirty(session: FigurePublicationSession | null): boolean {
  return session !== null && figureDocumentsDiffer(session.baseline, session.draft);
}

/** Closing a plot window the user styled but never saved as an editable
 *  figure asks first (figures audit #15: the work vanished without a word).
 *  A saved figure has its own gate (`editableFigureHasUnsavedEdits`); a
 *  default window, carrying nothing to lose, closes plainly. */
export function styledWindowCloseNeedsConfirm(state: AppState, window: PlotWindow): boolean {
  if (window.kind !== "plot" || !window.document) return false;
  if (state.editableFigures.some((document) => document.id === window.document?.id)) return false;
  return windowHasUserEdits(state, window);
}
