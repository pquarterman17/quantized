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

import { markNotRemembered } from "../lib/windowLayout/template";
import { pinData, unpinData } from "../lib/windowLayout/dataSource";
import { close, dock, dockAll, float, floatAll, focusWindow, plotBesideData, reopen, stackOf, tileAll, toggleDock } from "../lib/windowLayout/ops";
import { clearPin, setPin } from "../lib/windowLayout/pins";
import { ANALYSIS_MIN_SHARE, ANALYSIS_SHARE, giveShare } from "../lib/windowLayout/shares";
import { kindOf } from "../lib/windowLayout/refs";
import type { Slot, WindowLayoutV1, WindowRef } from "../lib/windowLayout/types";
import { cascadeGeometry } from "../lib/plotWindows";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { PlotWindow } from "../lib/plotview";
import { DEFAULT_EDGE, slotBox, slotHidden } from "../lib/windowLayout/visibility";
import { setStyleWindowToggle } from "./inspectorToggle";
import { isToolMounted, layoutTool } from "./layoutTools";
import { useApp } from "./useApp";

/** The plot-window id of a `plot:*` ref, else null. */
export const plotIdOf = (ref: WindowRef): string | null => (ref.startsWith("plot:") ? ref.slice(5) : null);

/** The plot-family window (plot, map, worksheet, ...) with this id, read now (imperative: for handlers and effects). */
export const plotWindowOf = (id: string) => useApp.getState().plotWindows.find((w) => w.id === id);

/** The tool id of a `tool:*` ref, else null. */
export const toolIdOf = (ref: WindowRef): string | null => (ref.startsWith("tool:") ? ref.slice(5) : null);

/** Where a non-plot window's float rect lives in `toolWindowLayout`: a tool by
 *  its bare id (the rect classic mode uses too, plan "Layout model"), Data,
 *  Analysis and Style by their ref. */
export const floatKeyOf = (ref: WindowRef): string => toolIdOf(ref) ?? ref;

/** Windows this release renders: plot windows, Data, Analysis, Style, and a
 *  tool window while its tool is mounted (store/layoutTools). A `tool:*`
 *  placement whose tool is closed is kept for reopen but never drawn, focused
 *  or tiled. */
export function isHosted(ref: WindowRef): boolean {
  const tool = toolIdOf(ref);
  if (tool !== null) return isToolMounted(tool);
  return ref === "style" || ref === "data" || ref === "analysis" || ref.startsWith("plot:");
}

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

/** Apply one op to the live layout; a no-op (same object) writes nothing. `remember` false is for the
 *  host's own upkeep (reconcile after a project opens, a tool's first placement, the narrow tile): the
 *  per-user template follows the user's layout edits only (plan P6 provisional, UX pass 5 m4). */
export function applyLayout(op: (layout: WindowLayoutV1) => WindowLayoutV1, remember = true): void {
  const prev = useApp.getState().windowLayout;
  if (!prev) return;
  const next = op(prev);
  if (next === prev) return;
  settleFloated(prev, next);
  useApp.getState().setWindowLayout(remember ? next : markNotRemembered(next));
}

/** Write a layout BACK, not a move: no newly-floated normalisation (`settleFloated`), so plot windows keep
 *  their z, geometry and maximized state. For the narrow-screen untile (plan P5, D6), which gives back
 *  the user's own layout exactly: its floating plot windows were floating there before the tile. */
export function restoreLayout(op: (layout: WindowLayoutV1) => WindowLayoutV1): void {
  const prev = useApp.getState().windowLayout;
  if (!prev) return;
  const next = op(prev);
  if (next !== prev) useApp.getState().setWindowLayout(markNotRemembered(next));
}

/** A title-bar dock button: dock there, or float when already docked there (D2). */
export const toggleDockRef = (ref: WindowRef, slot: Slot) => applyLayout((l) => toggleDock(l, ref, slot));
export const dockRef = (ref: WindowRef, slot: Slot) => applyLayout((l) => dock(l, ref, slot));
export const floatRef = (ref: WindowRef) => applyLayout((l) => float(l, ref));

/** Why the last plot window cannot be closed (the store keeps one, as classic does). */
export const LAST_PLOT_REASON = "The last plot window cannot be closed; open another plot window first.";

/** Is `ref` the only plot window left (`kind: "plot"`; snapshots and the like do not count)? */
export function isLastPlotWindow(ref: WindowRef, plotWindows: readonly PlotWindow[] = useApp.getState().plotWindows): boolean {
  const id = plotIdOf(ref);
  return id !== null && plotWindows.find((w) => w.id === id)?.kind === "plot" && plotWindows.filter((w) => w.kind === "plot").length <= 1;
}

/** Close a window. A plot window is really closed (the classic ✕, with its
 *  unsaved-figure confirm); its placement goes when the window does. Any
 *  other window keeps its placement for reopen. The last plot window cannot
 *  close: the refusal says why (status line) and is returned for the caller to
 *  announce, instead of the click doing nothing. */
export function closeRef(ref: WindowRef): string | null {
  // A tool closes through its own workshop (its open flag lives there); the
  // placement then closes when the tool unmounts (LayoutToolWindow).
  const onClose = (() => {
    const tool = toolIdOf(ref);
    return tool === null ? undefined : layoutTool(tool)?.onClose;
  })();
  if (onClose) {
    onClose();
    return null;
  }
  const id = plotIdOf(ref);
  if (id === null) {
    applyLayout((l) => close(l, ref));
    return null;
  }
  if (isLastPlotWindow(ref)) {
    useApp.getState().setStatus(LAST_PLOT_REASON, "warn");
    return LAST_PLOT_REASON;
  }
  void runLazy("Loading window actions…", () => import("../components/windows/figureLifecycleUi")).then(
    (m) => m.closeFigureWindow(id),
    onLoadFailure,
  );
  return null;
}

/** Reopen a closed window where it was, or bring an open one forward (D7). */
export function reopenRef(ref: WindowRef, remember = true): void {
  const id = plotIdOf(ref);
  const win = id === null ? undefined : useApp.getState().plotWindows.find((w) => w.id === id);
  if (win?.winState === "minimized") useApp.getState().restoreWindow(win.id);
  applyLayout((l) => {
    const next = reopen(l, ref);
    // Floating windows sit above docked ones: a window that would reopen docked under a plot that
    // covers its whole slot floats instead, so it is never opened out of sight (UX pass 2, M1).
    const slot = next.placements[ref]?.slot ?? null;
    if (l.placements[ref]?.open || slot === null) return next;
    if (slotIsHidden(l, slot)) return float(l, ref);
    // Analysis is the tallest content: it takes most of a shared slot when it opens into one (UX pass 3, M4).
    if (ref === "analysis") return giveShare(next, ref, ANALYSIS_SHARE);
    // ...and keeps at least half of it when another window opens beside it (Data from the Inspect step).
    // (Only when it had that much before: a share the user dragged smaller is theirs.)
    const beside = next.placements.analysis;
    const was = l.placements.analysis;
    return beside?.open && beside.slot === slot && beside.share < ANALYSIS_MIN_SHARE && was?.open && was.slot === slot && was.share >= ANALYSIS_MIN_SHARE ? giveShare(next, "analysis", was.share) : next;
  }, remember);
}

/** Would a window docked to `slot` now be (nearly) covered by floating windows? Counts every floating
 *  window: the plot windows (a maximized one fills the desk from its corner) and the Style, Data,
 *  Analysis and tool frames, which sit above them. */
function slotIsHidden(l: WindowLayoutV1, slot: Slot): boolean {
  const desk = document.querySelector(".qzk-wl-desk")?.getBoundingClientRect();
  if (!desk) return false;
  const px = slot === "centre" ? 0 : l.edges[slot] > 0 ? l.edges[slot] : DEFAULT_EDGE[slot];
  const plots = useApp
    .getState()
    .plotWindows.filter((w) => floating(l, `plot:${w.id}`) && w.winState !== "minimized")
    .map((w) => (w.winState === "maximized" ? { x: 0, y: 0, w: desk.width, h: desk.height } : { x: w.geometry.x, y: w.geometry.y, w: w.geometry.w, h: w.geometry.h }));
  const frames = [...document.querySelectorAll("[data-tool-window]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - desk.left, y: r.top - desk.top, w: r.width, h: r.height };
  });
  return slotHidden(slotBox(slot, px, desk), [...plots, ...frames]);
}

/** A pointer or keyboard landing in a window: a plot window takes the app's
 *  focus (only `kind: "plot"` can, as in classic), a floating one comes forward. */
export function focusRef(ref: WindowRef): void {
  const s = useApp.getState();
  const id = plotIdOf(ref);
  const win = id === null ? undefined : s.plotWindows.find((w) => w.id === id);
  if (win) {
    // The focused plot under a map or worksheet raised after it comes back to the front (no-op when it already is);
    // the figure commands read the front window as the one the user is working in (lib/figureTarget).
    if (win.kind === "plot" && win.id !== s.focusedWindowId) s.focusWindow(win.id);
    else s.raiseWindow(win.id);
  }
  applyLayout((l) => focusWindow(l, ref));
}

/** The focused plot window's ref, when the layout holds it. */
export function focusedPlotRef(l: WindowLayoutV1): WindowRef | null {
  const id = useApp.getState().focusedWindowId;
  return id && l.placements[`plot:${id}`] ? `plot:${id}` : null;
}

/** The focused plot window's ref in the live layout, or null. */
export function currentFocusedPlot(): WindowRef | null {
  const l = useApp.getState().windowLayout;
  return l ? focusedPlotRef(l) : null;
}

/** "Dock all" (D4): focused plot centre, Data, Style and Analysis right, tools bottom; the
 *  centre goes back to a row (the way out of a Tile all grid). */
export const dockAllWindows = () =>
  applyLayout((l) => {
    const next = dockAll(l, focusedPlotRef(l));
    return next.centre === "row" ? next : { ...next, centre: "row" };
  });
/** "Float all" (D4). */
export const floatAllWindows = () => applyLayout(floatAll);

/** "Tile all" (D4): every content window on screen (plots, Data, tools) shares
 *  the centre as a grid, in reading order. Style is the Inspector, a panel for
 *  the plot rather than a tile of the grid: it stays where it is, docked or
 *  floating. Minimized plot windows stay in the strip. */
export function tileAllWindows(): void {
  applyLayout((l) => {
    const docked = (["left", "centre", "right", "bottom"] as const).flatMap((s) => stackOf(l, s));
    const refs = [...docked, ...l.z].filter((r) => r !== "style" && isShown(l, r));
    return refs.length ? tileAll(l, refs) : l;
  });
}

/** Freeze the Data window on `datasetId` (its pin button). */
export const pinDataWindow = (datasetId: string) => applyLayout((l) => pinData(l, datasetId));
/** Let the Data window follow again. */
export const unpinDataWindow = () => applyLayout(unpinData);
/** The Analysis window's pin (plan P4). */
export const pinAnalysis = (datasetId: string) => applyLayout((l) => setPin(l, "analysis", datasetId));
export const unpinAnalysis = () => applyLayout((l) => clearPin(l, "analysis"));

/** Is there a focused plot window for Plot | Data to use? */
export function canPlotBesideData(): boolean {
  const l = useApp.getState().windowLayout;
  return l !== null && focusedPlotRef(l) !== null;
}

/** "Plot | Data side by side" (D4): the focused plot, then Data, at the head
 *  of the centre in a row; every other window stays where it is. A minimized
 *  focused plot is restored first. No focused plot: nothing changes. */
export function plotBesideDataWindows(): void {
  const s = useApp.getState();
  const plot = s.windowLayout ? focusedPlotRef(s.windowLayout) : null;
  if (!plot) return;
  const win = s.plotWindows.find((w) => w.id === plotIdOf(plot));
  if (win?.winState === "minimized") s.restoreWindow(win.id);
  applyLayout((l) => plotBesideData(l, plot));
}

/** Open a singleton window where it was, or close it when open (the toolbar pills, Window menu, ⌘K). */
export function toggleWindow(ref: "data" | "analysis" | "style"): void {
  if (useApp.getState().windowLayout?.placements[ref]?.open === true) closeRef(ref);
  else reopenRef(ref);
}

/** Route ⌘] / View ▸ Toggle inspector (store/inspectorToggle.ts) to the Style
 *  window while the host is mounted; returns the uninstall for the effect. */
export function installStyleToggle(): () => void {
  const open = () => useApp.getState().windowLayout?.placements.style?.open === true;
  setStyleWindowToggle([open, () => (open() ? closeRef("style") : reopenRef("style"))]);
  return () => setStyleWindowToggle(null);
}
