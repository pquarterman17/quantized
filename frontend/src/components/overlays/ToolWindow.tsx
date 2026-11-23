// Every workshop's window. In classic mode this is the classic frame
// (./ToolWindowFrame.tsx), exactly as before. In the window layout
// (WORKSPACE_LAYOUT_PLAN P4, D1/D7) the layout decides: an analysis tool
// (lib/windowLayout/toolCatalog) becomes a layout window, one per tool, docked
// or floating like any other and following the focused plot with a pin, and
// its side-column dock (store/toolDock.ts) is never registered; any other panel
// keeps this classic frame. The layout half lives in the layout host's own lazy
// chunk, so classic mode never loads it. `classic` asks for the frame itself
// (the layout's own floating windows use it).

import type { ComponentType } from "react";

import { lazyRegion } from "../../lib/lazyRegion";
import { useApp } from "../../store/useApp";
import ToolWindowFrame, { type ToolWindowProps } from "./ToolWindowFrame";

export type { ToolWindowProps };

type LayoutProps = ToolWindowProps & { Frame: ComponentType<ToolWindowProps> };

async function loadLayoutToolWindow(): Promise<{ default: ComponentType<LayoutProps> }> {
  const m = await import("../workshops/windowlayout/LayoutHost");
  return { default: m.LayoutToolWindow };
}
const LayoutToolWindow = lazyRegion(loadLayoutToolWindow, "Tool window");

export default function ToolWindow({ classic = false, ...props }: ToolWindowProps & { classic?: boolean }) {
  const hosted = useApp((s) => s.layoutMode === "windows") && !classic;
  return hosted ? <LayoutToolWindow {...props} Frame={ToolWindowFrame} /> : <ToolWindowFrame {...props} />;
}
