// A `dock="right"` ToolWindow tells store/rightDock.ts where its left edge is
// while it is docked (open, expanded, right edge at the viewport's right
// edge), so the stage reflows beside it; it un-docks when dragged away,
// collapsed or closed.

import { useEffect, useState } from "react";

import { isRightDocked, setRightDock } from "../../store/rightDock";

export function useRightDockRegistration(
  id: string,
  enabled: boolean,
  layout: { x: number; width: number; collapsed: boolean },
): void {
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  useEffect(() => {
    if (!enabled) return;
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled]);
  const docked = enabled && !layout.collapsed && isRightDocked(layout.x, layout.width, viewport);
  useEffect(() => {
    setRightDock(id, docked ? layout.x : null);
  }, [id, docked, layout.x]);
  useEffect(() => () => setRightDock(id, null), [id]);
}
