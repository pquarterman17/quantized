// "Toggle inspector" (the title-bar button, ⌘] and View ▸ Toggle inspector
// panel), aware of a docked analysis window (UX-F, store/toolDock.ts). A docked
// window REPLACES the Inspector, so flipping the collapse flag would change
// nothing on screen: instead the window floats and the Inspector shows. With
// nothing docked it is the plain collapse toggle. Kept out of useApp.ts (the
// store-size ratchet) and out of toolDock.ts (which must not import the store:
// the tool-window slice imports it).

import { floatDockedWindow, toolDockSnapshot } from "./toolDock";
import { useApp } from "./useApp";

export function toggleInspector(): void {
  if (floatDockedWindow()) useApp.setState({ rightCollapsed: false });
  else useApp.getState().toggleRight();
}

/** Whether the Inspector is on screen (not collapsed, not replaced). */
export function inspectorShown(): boolean {
  return !useApp.getState().rightCollapsed && toolDockSnapshot().owner === null;
}
