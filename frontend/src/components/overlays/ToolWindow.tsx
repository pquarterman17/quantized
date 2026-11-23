// Every workshop's window. In classic mode, and for any panel that is not an
// analysis tool, this is the classic frame (./ToolWindowFrame.tsx), exactly as
// before. In the window layout (WORKSPACE_LAYOUT_PLAN P4, D1/D7) an analysis
// tool (lib/windowLayout/toolCatalog) is a layout window instead: one per tool,
// docked or floating like any other, following the focused plot with a pin. Its
// side-column dock (store/toolDock.ts) is never registered there. The layout
// half is its own lazy chunk, so classic mode never loads it.

import { lazyRegion } from "../../lib/lazyRegion";
import { isLayoutTool } from "../../lib/windowLayout/toolCatalog";
import { useApp } from "../../store/useApp";
import ToolWindowFrame, { type ToolWindowProps } from "./ToolWindowFrame";

export type { ToolWindowProps };

const LayoutToolWindow = lazyRegion(() => import("../workshops/windowlayout/LayoutToolWindow"), "Tool window");

export default function ToolWindow(props: ToolWindowProps) {
  const hosted = useApp((s) => s.layoutMode === "windows" && isLayoutTool(props.id));
  return hosted ? <LayoutToolWindow {...props} /> : <ToolWindowFrame {...props} />;
}
