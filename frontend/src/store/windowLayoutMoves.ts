// The store-side halves of the window layout's title-bar drag and keyboard
// move mode (WORKSPACE_LAYOUT_PLAN P2): float a docked window at the pointer,
// nudge a floating one, snapshot and restore what a gesture may change, and
// pick the move-mode target. Kept out of components/ so the components' own
// `useApp.getState()` footprint (the getState ratchet) does not grow. Lazy:
// only the layout host's subtree imports it.

import type { PlotWindow } from "../lib/plotview";
import { clampToolWindowPos, STATUS_BAR_HEIGHT, TITLE_BAR_HEIGHT, type ToolWindowLayout } from "../lib/toolwindow";
import type { Placement, WindowLayoutV1, WindowRef } from "../lib/windowLayout/types";
import { useApp } from "./useApp";
import { floatRef, isShown, plotIdOf } from "./windowLayoutActions";

const STYLE_WIDTH = 360;

/** A plot window's position clamp and minimum size: the frame's own
 *  (components/windows/usePlotWindowGesture), passed in because store/ may not
 *  import components/. */
export interface PlotLimits {
  clamp: (x: number, y: number, bounds: { width: number; height: number } | undefined) => { x: number; y: number };
  minW: number;
  minH: number;
}

export const placementNow = (ref: WindowRef): Placement | undefined => useApp.getState().windowLayout?.placements[ref];
export const toolLayoutOf = (ref: WindowRef): ToolWindowLayout | undefined => useApp.getState().toolWindowLayout[ref];

/** Put a tool window's float rect back (`undefined`: it had none). */
export function restoreToolLayout(ref: WindowRef, before: ToolWindowLayout | undefined): void {
  if (before) useApp.getState().setToolWindowLayout(ref, before);
  else useApp.setState((s) => ({ toolWindowLayout: Object.fromEntries(Object.entries(s.toolWindowLayout).filter(([k]) => k !== ref)) }));
}

/** Float a docked window so the pointer stays where it was on its title bar
 *  (`grab`: the fraction across it and the px down it). A plot window keeps
 *  its size (within the desk); Style floats at its stored or default width. */
export function floatAtPointer(ref: WindowRef, desk: { left: number; top: number; width: number; height: number }, p: { x: number; y: number }, grab: { fx: number; dy: number }, limits: PlotLimits): void {
  const s = useApp.getState();
  floatRef(ref);
  const id = plotIdOf(ref);
  if (id !== null) {
    const win = s.plotWindows.find((w) => w.id === id);
    if (!win) return;
    const w = Math.round(Math.max(limits.minW, Math.min(win.geometry.w, desk.width * 0.8)));
    const h = Math.round(Math.max(limits.minH, Math.min(win.geometry.h, desk.height * 0.8)));
    const at = limits.clamp(Math.round(p.x - desk.left - grab.fx * w), Math.round(p.y - desk.top - grab.dy), desk);
    s.setWindowGeometry(id, { ...at, w, h });
    return;
  }
  const stored = s.toolWindowLayout[ref];
  const width = stored?.width ?? STYLE_WIDTH;
  const at = clampToolWindowPos(Math.round(p.x - grab.fx * width), Math.round(p.y - grab.dy), width, TITLE_BAR_HEIGHT, {
    width: window.innerWidth,
    height: window.innerHeight - STATUS_BAR_HEIGHT,
  });
  s.setToolWindowLayout(ref, { ...at, width, height: stored?.height ?? null, collapsed: false });
}

export interface MoveSnapshot {
  layout: WindowLayoutV1;
  plot: Pick<PlotWindow, "geometry" | "z" | "winState"> | undefined;
  tool: ToolWindowLayout | undefined;
}

/** What move mode may change for `ref`, to put back on Escape. */
export function takeSnapshot(ref: WindowRef): MoveSnapshot {
  const s = useApp.getState();
  const id = plotIdOf(ref);
  const win = id === null ? undefined : s.plotWindows.find((w) => w.id === id);
  return { layout: s.windowLayout!, plot: win && { geometry: win.geometry, z: win.z, winState: win.winState }, tool: s.toolWindowLayout[ref] };
}

/** Put a snapshot back; true when that changed the layout itself. */
export function restoreSnapshot(ref: WindowRef, snap: MoveSnapshot): boolean {
  const id = plotIdOf(ref);
  const changed = useApp.getState().windowLayout !== snap.layout;
  useApp.setState((s) => ({
    windowLayout: snap.layout,
    plotWindows: snap.plot ? s.plotWindows.map((w) => (w.id === id ? { ...w, ...snap.plot } : w)) : s.plotWindows,
  }));
  restoreToolLayout(ref, snap.tool);
  return changed;
}

/** Move a floating window by (dx, dy); the sentence to announce. `toolRect`
 *  is the tool window's on-screen box, for one that has no stored rect yet. */
export function nudge(ref: WindowRef, title: string, dx: number, dy: number, toolRect: DOMRect | undefined, limits: PlotLimits): string {
  const s = useApp.getState();
  const id = plotIdOf(ref);
  let from: { x: number; y: number };
  let to: { x: number; y: number };
  if (id !== null) {
    const win = s.plotWindows.find((w) => w.id === id);
    if (!win || win.winState === "maximized") return `${title} cannot move while maximized`;
    from = win.geometry;
    to = limits.clamp(from.x + dx, from.y + dy, s.plotCanvasBounds ?? undefined);
    if (to.x !== from.x || to.y !== from.y) s.setWindowGeometry(id, to);
  } else {
    const cur: ToolWindowLayout = s.toolWindowLayout[ref] ?? { x: toolRect?.left ?? 0, y: toolRect?.top ?? 0, width: toolRect?.width ?? STYLE_WIDTH, height: null, collapsed: false };
    from = cur;
    to = clampToolWindowPos(cur.x + dx, cur.y + dy, cur.width, TITLE_BAR_HEIGHT, { width: window.innerWidth, height: window.innerHeight - STATUS_BAR_HEIGHT });
    if (to.x !== from.x || to.y !== from.y) s.setToolWindowLayout(ref, { ...cur, ...to });
  }
  return to.x === from.x && to.y === from.y ? `${title} is at the edge of the desk` : `${title} moved to ${to.x}, ${to.y}`;
}

/** The window move mode acts on: the one holding focus, else the focused plot
 *  window; null when neither is on screen. */
export function moveTarget(layout: WindowLayoutV1, fromFocus: WindowRef | null): WindowRef | null {
  const id = useApp.getState().focusedWindowId;
  const ref = fromFocus ?? (id ? (`plot:${id}` as WindowRef) : null);
  return ref && isShown(layout, ref) ? ref : null;
}
