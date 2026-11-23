// View ▸ "Window layout (preview)" (WORKSPACE_LAYOUT_PLAN P1): the opt-in
// switch between the classic stage and the dockable-window layout. Part of
// the full command list (appCommands.ts, loaded right after mount), not the
// startup one, so classic users pay nothing at first paint for it. The same
// switch is in Preferences ▸ Interaction (overlays/WindowLayoutPref.tsx).

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";

export function buildLayoutModeCommands(s: StoreGet): Action[] {
  return [
    {
      id: "window-layout-preview",
      group: "View",
      section: "Panels & workspace",
      label: "Window layout (preview)",
      description: "Switch to the preview layout where the plot and Style are windows you can dock to an edge, the centre, or float.",
      keywords: "dock float tile windows panels layout preview",
      checked: () => s().layoutMode === "windows",
      run: () => void s().setLayoutMode(s().layoutMode === "windows" ? "classic" : "windows"),
    },
    {
      // The way back, findable by what the user wants to do (⌘K only: the View
      // menu's checked toggle above already leaves the layout).
      id: "window-layout-classic",
      group: "View",
      section: "Panels & workspace",
      label: "Switch to the classic layout",
      description: "Leave the window layout and go back to the classic stage and Inspector; the window layout is kept for next time.",
      keywords: "classic layout back leave undock windows preview",
      paletteOnly: true,
      disabled: () => s().layoutMode !== "windows",
      disabledReason: "The classic layout is already in use.",
      run: () => void s().setLayoutMode("classic"),
    },
  ];
}
