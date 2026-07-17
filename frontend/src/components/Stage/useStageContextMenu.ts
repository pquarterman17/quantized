// The plot canvas's right-click state — extracted out of PlotStage.tsx
// (which sits at its line-ceiling ratchet pin) to make room for ToolHud in
// the same commit; also where GUI_INTERACTION #9 item 3 lives: right-click
// must cancel a half-drawn region BEFORE the menu opens, not leave it
// stranded under an opened PlotContextMenu.
//
// Previously a right-click during a live left-button drag (`e.buttons & 1`)
// was silently swallowed — no menu opened, but the drag's document
// mousemove/mouseup listeners stayed live underneath, so the "half-drawn
// region" was still there, just invisible to the user's next click. Now:
// cancel any in-progress plot-tool gesture first (lib/gestureCancel — the
// drag's own listeners tear down without committing a result), then always
// open the menu, so a mid-gesture right-click both ends the drag cleanly
// AND gives the usual context menu.

import { useState } from "react";

import { cancelActiveGesture } from "../../lib/gestureCancel";
import type { PlotPayload } from "../../lib/plotdata";

export interface StageContextMenuResult {
  menu: { x: number; y: number } | null;
  setMenu: (menu: { x: number; y: number } | null) => void;
  onStageContextMenu: (e: React.MouseEvent) => void;
}

export function useStageContextMenu(displayPayload: PlotPayload | null): StageContextMenuResult {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const onStageContextMenu = (e: React.MouseEvent): void => {
    if (!displayPayload) return;
    e.preventDefault();
    cancelActiveGesture();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return { menu, setMenu, onStageContextMenu };
}
