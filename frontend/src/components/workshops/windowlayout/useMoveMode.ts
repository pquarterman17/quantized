// Keyboard move mode (WORKSPACE_LAYOUT_PLAN D13): Alt+Shift+M on a focused
// window (or, with focus elsewhere, the focused plot window). While it lasts,
// arrows move a floating window (Shift: 1 px), L / R / B / C dock it left,
// right, bottom or centre, F floats it, Enter commits and Escape cancels and
// restores everything the mode changed. Alt+Shift+M again also commits.
// Alt+Shift+M is free in the app's shortcut map (no other Alt+Shift binding
// exists); like F6 it is claimed only while windows mode is on, and, as every
// app shortcut, never under a modal dialog (lib/appShortcuts).

import { useEffect, useRef, useState } from "react";

import { listenForAppShortcuts, isModalOpen } from "../../../lib/appShortcuts";
import { pushEscapeSurface } from "../../../lib/escapeStack";
import { clampToolWindowPos, STATUS_BAR_HEIGHT, TITLE_BAR_HEIGHT } from "../../../lib/toolwindow";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import type { PlotWindow } from "../../../lib/plotview";
import type { ToolWindowLayout } from "../../../lib/toolwindow";
import { useApp } from "../../../store/useApp";
import { dockRef, floatRef, isShown, plotIdOf } from "../../../store/windowLayoutActions";
import { clampPlotWindowPosition } from "../../windows/usePlotWindowGesture";
import { announce } from "./layoutAnnounce";
import { stopOf } from "./useLayoutKeyboard";
import { moveAction } from "./moveKeys";

export interface MoveState {
  ref: WindowRef;
  title: string;
}

interface Snapshot {
  layout: WindowLayoutV1;
  plot: Pick<PlotWindow, "geometry" | "z" | "winState"> | undefined;
  tool: ToolWindowLayout | undefined;
}

const take = (ref: WindowRef): Snapshot => {
  const s = useApp.getState();
  const id = plotIdOf(ref);
  const win = id === null ? undefined : s.plotWindows.find((w) => w.id === id);
  return {
    layout: s.windowLayout!,
    plot: win && { geometry: win.geometry, z: win.z, winState: win.winState },
    tool: s.toolWindowLayout[ref],
  };
};

function restore(ref: WindowRef, snap: Snapshot): void {
  const id = plotIdOf(ref);
  useApp.setState((s) => ({
    windowLayout: snap.layout,
    plotWindows: snap.plot ? s.plotWindows.map((w) => (w.id === id ? { ...w, ...snap.plot } : w)) : s.plotWindows,
    toolWindowLayout: snap.tool
      ? { ...s.toolWindowLayout, [ref]: snap.tool }
      : Object.fromEntries(Object.entries(s.toolWindowLayout).filter(([k]) => k !== ref)),
  }));
}

/** Move a floating window by (dx, dy); the sentence to announce. */
function nudge(ref: WindowRef, title: string, dx: number, dy: number): string {
  const s = useApp.getState();
  const id = plotIdOf(ref);
  const win = id === null ? undefined : s.plotWindows.find((w) => w.id === id);
  let from: { x: number; y: number };
  let to: { x: number; y: number };
  if (id !== null) {
    if (!win || win.winState === "maximized") return `${title} cannot move while maximized`;
    from = win.geometry;
    to = clampPlotWindowPosition(from.x + dx, from.y + dy, s.plotCanvasBounds ?? undefined);
    if (to.x !== from.x || to.y !== from.y) s.setWindowGeometry(id, to);
  } else {
    const el = document.querySelector<HTMLElement>(`[data-tool-window="${CSS.escape(ref)}"]`)?.getBoundingClientRect();
    const cur: ToolWindowLayout = s.toolWindowLayout[ref] ?? { x: el?.left ?? 0, y: el?.top ?? 0, width: el?.width ?? 360, height: null, collapsed: false };
    from = cur;
    to = clampToolWindowPos(cur.x + dx, cur.y + dy, cur.width, TITLE_BAR_HEIGHT, { width: window.innerWidth, height: window.innerHeight - STATUS_BAR_HEIGHT });
    if (to.x !== from.x || to.y !== from.y) s.setToolWindowLayout(ref, { ...cur, ...to });
  }
  return to.x === from.x && to.y === from.y ? `${title} is at the edge of the desk` : `${title} moved to ${to.x}, ${to.y}`;
}

function startTarget(layout: WindowLayoutV1): WindowRef | null {
  const s = useApp.getState();
  const stop = stopOf(document.activeElement);
  const fromFocus = stop && stop !== "library" ? stop : null;
  const plot = s.focusedWindowId ? (`plot:${s.focusedWindowId}` as WindowRef) : null;
  const ref = fromFocus ?? plot;
  return ref && isShown(layout, ref) ? ref : null;
}

export function useMoveMode(layout: WindowLayoutV1 | null, titleOf: (ref: WindowRef) => string): MoveState | null {
  const [mode, setMode] = useState<MoveState | null>(null);
  const snap = useRef<Snapshot | null>(null);
  const live = useRef({ layout, titleOf, mode });
  useEffect(() => {
    live.current = { layout, titleOf, mode };
  });

  const exit = (message: string) => {
    snap.current = null;
    setMode(null);
    announce(message);
  };

  useEffect(
    () =>
      listenForAppShortcuts((e) => {
        if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== "KeyM") return;
        e.preventDefault();
        const { layout: l, titleOf: t, mode: m } = live.current;
        if (m) return exit(`Move mode off, ${m.title} placed`);
        const ref = l ? startTarget(l) : null;
        if (!ref) return announce("Focus a window first, then press Alt+Shift+M to move it");
        snap.current = take(ref);
        setMode({ ref, title: t(ref) });
        announce(`Move mode on for ${t(ref)}. Arrows move, L R B C dock, F floats, Enter keeps, Escape cancels`);
      }),
    [],
  );

  useEffect(() => {
    if (!mode) return;
    const { ref, title } = mode;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (isModalOpen() || t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const action = moveAction(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const placement = useApp.getState().windowLayout?.placements[ref];
      if (action.type === "commit") return exit(`Move mode off, ${title} placed`);
      if (action.type === "move") return announce(placement?.slot ? `${title} is docked; press F to float it before moving` : nudge(ref, title, action.dx, action.dy));
      if (action.type === "float") return placement?.slot === null ? announce(`${title} is already floating`) : floatRef(ref);
      if (placement?.slot === action.slot) return announce(`${title} is already docked ${action.slot}`);
      dockRef(ref, action.slot);
    };
    window.addEventListener("keydown", onKey, true);
    const off = pushEscapeSurface("gesture", () => {
      if (snap.current) {
        const changed = useApp.getState().windowLayout !== snap.current.layout;
        restore(ref, snap.current);
        if (!changed) announce(`Move cancelled, ${title} back where it was`);
      }
      snap.current = null;
      setMode(null);
      return true;
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      off();
    };
  }, [mode]);

  // A dock button or a re-dock remounts the window: put focus back on its title bar.
  const slot = mode && layout ? (layout.placements[mode.ref]?.slot ?? "float") : null;
  useEffect(() => {
    if (mode) document.querySelector<HTMLElement>(`[data-wl-focus="${CSS.escape(mode.ref)}"]`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  return mode;
}
