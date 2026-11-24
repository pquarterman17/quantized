// The tool-window title bar's right-click menu (UX menus audit M5): Float or
// Dock, Collapse or Expand, Help and Close, the same actions as the title-bar
// buttons. Lazy (via useToolWindowMenu) so it costs nothing until first use.

import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

export interface ToolWindowTitleMenuProps {
  x: number;
  y: number;
  panelName: string;
  /** Float / dock, only for a dock-capable window. */
  dock?: { docked: boolean; toggle: () => void };
  /** Collapse / expand, only when the window floats. */
  collapse?: { collapsed: boolean; toggle: () => void };
  onHelp?: () => void;
  onCloseWindow?: () => void;
  onClose: () => void;
}

export default function ToolWindowTitleMenu({ x, y, panelName, dock, collapse, onHelp, onCloseWindow, onClose }: ToolWindowTitleMenuProps) {
  const items: ContextMenuItem[] = [];
  if (dock) items.push({ label: dock.docked ? "Float" : "Dock in side panel", run: dock.toggle });
  if (collapse) items.push({ label: collapse.collapsed ? "Expand" : "Collapse", run: collapse.toggle });
  if (onHelp) items.push({ label: `Help for ${panelName}`, run: onHelp });
  if (onCloseWindow) {
    if (items.length) items.push({ separator: true });
    items.push({ label: "Close", run: onCloseWindow });
  }
  if (!items.length) return null;
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
