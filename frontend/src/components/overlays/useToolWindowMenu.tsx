// Right-click handling for the classic ToolWindow frame (UX menus audit M5).
// The frame is a DOM and React child of the stage, so a bare `contextmenu`
// bubbled to PlotStage and opened the PLOT's menu under a tool window (title
// bar, Columns list, any body text). The handler below ends that bubble for
// the whole window. The title bar gets its own menu; an editable field keeps
// the browser's native menu (cut / copy / paste); a nested producer such as
// the result-table menu has already handled the event in the capture-free
// bubble before it reaches here.

import { useState, type MouseEvent, type ReactNode } from "react";

import { lazyRegion } from "../../lib/lazyRegion";
import type { ToolWindowTitleMenuProps } from "./ToolWindowTitleMenu";

const ToolWindowTitleMenu = lazyRegion(() => import("./ToolWindowTitleMenu"), "Window menu");

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

type MenuActions = Omit<ToolWindowTitleMenuProps, "x" | "y" | "onClose">;

export function useToolWindowMenu(actions: MenuActions): { onContextMenu: (e: MouseEvent) => void; menu: ReactNode } {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: MouseEvent): void => {
    // Never reaches the plot stage underneath, whichever way it ends.
    e.stopPropagation();
    const target = e.target as Element | null;
    if (target?.closest?.(EDITABLE)) return;
    if (!target?.closest?.(".qzk-win-title")) return;
    e.preventDefault();
    setAt({ x: e.clientX, y: e.clientY });
  };
  const menu = at ? <ToolWindowTitleMenu {...actions} x={at.x} y={at.y} onClose={() => setAt(null)} /> : null;
  return { onContextMenu, menu };
}
