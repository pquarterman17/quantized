// What the window-layout host's buttons and commands do (WORKSPACE_LAYOUT_PLAN
// P1). Each action reads the live store, runs one pure op from
// lib/windowLayout/ops and writes the result through setWindowLayout. Lazy:
// only the host subtree (components/workshops/windowlayout/) imports this.
//
// Two plot-window side effects ride along with a float, neither an undo step
// (window moves are not undoable today, and layout changes never are):
// - a plot window that was MAXIMIZED while docked floats at its normal rect,
//   so floating it does not cover the whole desk;
// - a newly floated plot window whose top-left lands exactly on another
//   floating window's is cascaded (the "cascade for a window that never
//   floated" rule), so Float all never stacks frames invisibly.

import { close, dock, dockAll, float, floatAll, focusWindow, reopen, stackOf, tileAll, toggleDock } from "../lib/windowLayout/ops";
import { kindOf } from "../lib/windowLayout/refs";
import type { Slot, WindowLayoutV1, WindowRef } from "../lib/windowLayout/types";
import { cascadeGeometry } from "../lib/plotWindows";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { PlotWindow } from "../lib/plotview";
import { setStyleWindowToggle } from "./inspectorToggle";
import { useApp } from "./useApp";

/** The plot-window id of a `plot:*` ref, else null. */
export const plotIdOf = (ref: WindowRef): string | null => (ref.startsWith("plot:") ? ref.slice(5) : null);

/** Windows this release renders: plot windows and Style. A `tool:*`, Data or
 *  Analysis placement (seeded from a docked tool, or saved by a later release)
 *  is kept for later phases but never drawn, focused or tiled (plan P3/P4). */
export const isHosted = (ref: WindowRef): boolean => ref === "style" || ref.startsWith("plot:");

/** Is the window on screen? Hosted, open in the layout and, for a plot
 *  window, not minimized. `plotWindows` is the caller's (subscribed) list. */
export function isShown(layout: WindowLayoutV1, ref: WindowRef, plotWindows: readonly PlotWindow[] = useApp.getState().plotWindows): boolean {
  if (!isHosted(ref) || layout.placements[ref]?.open !== true) return false;
  const id = plotIdOf(ref);
  return id === null || plotWindows.some((w) => w.id === id && w.winState !== "minimized");
}

/** The classic cascade offset, so a floated window steps like a new one. */
const CASCADE_STEP_PX = cascadeGeometry(1).x - cascadeGeometry(0).x;

const floating = (l: WindowLayoutV1, r: WindowRef) => l.placements[r]?.open === true && l.placements[r]?.slot === null;

/** Normalise the plot windows that `next` floats and `prev` did not (header). */
function settleFloated(prev: WindowLayoutV1, next: WindowLayoutV1): void {
  const newly = next.z.filter((r) => kindOf(r) === "plot" && !floating(prev, r));
  if (!newly.length) return;
  const ids = new Set(newly.map(plotIdOf));
  useApp.setState((s) => {
    const taken = new Set(
      s.plotWindows.filter((w) => !ids.has(w.id) && floating(next, `plot:${w.id}`)).map((w) => `${w.geometry.x},${w.geometry.y}`),
    );
    // Newly floated frames come to the front, in the layout's z order (frames
    // stack by PlotWindow.z), as the op puts them in front of the others.
    let top = Math.max(0, ...s.plotWindows.map((w) => w.z));
    const zOf = new Map(newly.map((r) => [plotIdOf(r), ++top]));
    const plotWindows = s.plotWindows.map((w) => {
      if (!ids.has(w.id)) return w;
      let { x, y } = w.geometry;
      while (taken.has(`${x},${y}`)) {
        x += CASCADE_STEP_PX;
        y += CASCADE_STEP_PX;
      }
      taken.add(`${x},${y}`);
      return { ...w, z: zOf.get(w.id)!, geometry: { ...w.geometry, x, y }, winState: w.winState === "maximized" ? "normal" : w.winState };
    });
    return { plotWindows };
  });
}

/** Apply one op to the live layout; a no-op (same object) writes nothing. */
export function applyLayout(op: (layout: WindowLayoutV1) => WindowLayoutV1): void {
  const prev = useApp.getState().windowLayout;
  if (!prev) return;
  const next = op(prev);
  if (next === prev) return;
  settleFloated(prev, next);
  useApp.getState().setWindowLayout(next);
}

/** A title-bar dock button: dock there, or float when already docked there (D2). */
export const toggleDockRef = (ref: WindowRef, slot: Slot) => applyLayout((l) => toggleDock(l, ref, slot));
export const dockRef = (ref: WindowRef, slot: Slot) => applyLayout((l) => dock(l, ref, slot));
export const floatRef = (ref: WindowRef) => applyLayout((l) => float(l, ref));

/** Close a window. A plot window is really closed (the classic ✕, with its
 *  unsaved-figure confirm); its placement goes when the window does. Any
 *  other window keeps its placement for reopen. */
export function closeRef(ref: WindowRef): void {
  const id = plotIdOf(ref);
  if (id === null) return applyLayout((l) => close(l, ref));
  void runLazy("Loading window actions…", () => import("../components/windows/figureLifecycleUi")).then(
    (m) => m.closeFigureWindow(id),
    onLoadFailure,
  );
}

/** Reopen a closed window where it was, or bring an open one forward (D7). */
export function reopenRef(ref: WindowRef): void {
  const id = plotIdOf(ref);
  const win = id === null ? undefined : useApp.getState().plotWindows.find((w) => w.id === id);
  if (win?.winState === "minimized") useApp.getState().restoreWindow(win.id);
  applyLayout((l) => reopen(l, ref));
}

/** A pointer or keyboard landing in a window: a plot window takes the app's
 *  focus (only `kind: "plot"` can, as in classic), a floating one comes forward. */
export function focusRef(ref: WindowRef): void {
  const s = useApp.getState();
  const id = plotIdOf(ref);
  const win = id === null ? undefined : s.plotWindows.find((w) => w.id === id);
  if (win && win.id !== s.focusedWindowId) {
    if (win.kind === "plot") s.focusWindow(win.id);
    else s.raiseWindow(win.id);
  }
  applyLayout((l) => focusWindow(l, ref));
}

/** The focused plot window's ref, when the layout holds it. */
function focusedPlotRef(l: WindowLayoutV1): WindowRef | null {
  const id = useApp.getState().focusedWindowId;
  return id && l.placements[`plot:${id}`] ? `plot:${id}` : null;
}

/** "Dock all" (D4): focused plot centre, Style right, tools bottom; the
 *  centre goes back to a row (the way out of a Tile all grid). */
export const dockAllWindows = () =>
  applyLayout((l) => {
    const next = dockAll(l, focusedPlotRef(l));
    return next.centre === "row" ? next : { ...next, centre: "row" };
  });
/** "Float all" (D4). */
export const floatAllWindows = () => applyLayout(floatAll);

/** "Tile all" (D4): every window on screen shares the centre as a grid, in
 *  reading order. Minimized plot windows stay in the strip. */
export function tileAllWindows(): void {
  applyLayout((l) => {
    const docked = (["left", "centre", "right", "bottom"] as const).flatMap((s) => stackOf(l, s));
    const refs = [...docked, ...l.z].filter((r) => isShown(l, r));
    return refs.length ? tileAll(l, refs) : l;
  });
}

/** Route ⌘] / View ▸ Toggle inspector (store/inspectorToggle.ts) to the Style
 *  window while the host is mounted; returns the uninstall for the effect. */
export function installStyleToggle(): () => void {
  const open = () => useApp.getState().windowLayout?.placements.style?.open === true;
  setStyleWindowToggle([open, () => (open() ? closeRef("style") : reopenRef("style"))]);
  return () => setStyleWindowToggle(null);
}
