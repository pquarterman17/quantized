// A dock-capable ToolWindow's side-column docking (UX-F; store/toolDock.ts):
// registers the window as a claimant while it is mounted, says whether it owns
// the column now, and measures the column's slot (App renders
// `.qzk-tooldock-slot` in the Inspector's grid cell while a window is docked)
// so the window can sit exactly over it. The column is real grid space, so the
// stage reflows beside it and nothing overlaps the status bar.

import { useEffect, useLayoutEffect, useState } from "react";

import {
  dockToolWindow,
  registerDockable,
  setDockWidth,
  undockToolWindow,
  useToolDock,
} from "../../store/toolDock";

export interface DockRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SLOT = ".qzk-tooldock-slot";

function sameRect(a: DockRect | null, b: DockRect): boolean {
  return a !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** The docked column's box while `docked`, else null. */
function useDockSlotRect(docked: boolean): DockRect | null {
  const [rect, setRect] = useState<DockRect | null>(null);
  useLayoutEffect(() => {
    if (!docked) {
      setRect(null);
      return;
    }
    let raf = 0;
    let observer: ResizeObserver | null = null;
    let observed: Element | null = null;
    let retries = 3;
    const measure = () => {
      const slot = document.querySelector(SLOT);
      if (!slot) {
        // App commits the slot in the same store update; a frame or two covers
        // a render that has not landed yet. No App (a unit test): give up.
        if (retries-- > 0) raf = requestAnimationFrame(measure);
        return;
      }
      if (slot !== observed && typeof ResizeObserver !== "undefined") {
        observer?.disconnect();
        observer = new ResizeObserver(measure);
        observer.observe(slot);
        observed = slot;
      }
      const r = slot.getBoundingClientRect();
      const next = { left: r.left, top: r.top, width: r.width, height: r.height };
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [docked]);
  return rect;
}

export interface ToolWindowDock {
  /** The window offers Dock / Float at all. */
  dockable: boolean;
  /** It owns the side column right now. */
  docked: boolean;
  /** The column's box while docked (null before the first measure). */
  rect: DockRect | null;
  dock: () => void;
  undock: () => void;
}

export function useToolWindowDock(id: string, dockable: boolean, width: number): ToolWindowDock {
  const { owner } = useToolDock();
  // Claimed before paint, so a docked window never shows one floating frame.
  useLayoutEffect(() => (dockable ? registerDockable(id, width) : undefined),
    // Width changes go through setDockWidth: re-registering would re-claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, dockable]);
  useEffect(() => {
    if (dockable) setDockWidth(id, width);
  }, [id, dockable, width]);
  const docked = dockable && owner === id;
  const rect = useDockSlotRect(docked);
  return {
    dockable,
    docked,
    rect,
    dock: () => dockToolWindow(id),
    undock: () => undockToolWindow(id),
  };
}
