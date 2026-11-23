// The layout's arrange commands in the Window menu and the ⌘K palette
// (WORKSPACE_LAYOUT_PLAN D4), published while the host is mounted (windows
// mode only) through the shared command registry, the useWindowCommands
// pattern. "Plot | Data side by side" has no keyboard shortcut on purpose:
// the plan's Ctrl+Shift+D is already Duplicate Window, so the binding is the
// owner's call (D13).

import { useEffect } from "react";

import { useCommands, type Action } from "../../../store/commands";
import { canPlotBesideData, currentFocusedPlot, dockAllWindows, floatAllWindows, plotBesideDataWindows, tileAllWindows, toggleWindow } from "../../../store/windowLayoutActions";
import { resetWindowLayout } from "../../../store/windowLayoutReset";
import { holdAnnouncement } from "./layoutAnnounce";
import { focusTitleBar } from "./useLayoutKeyboard";

/** What Plot | Data does (the toolbar tooltip and the palette description). */
export const PLOT_DATA_HINT = "Open the Data window and share the centre with the focused plot, side by side.";
/** Why Plot | Data is unavailable: nothing to put Data beside. */
export const PLOT_DATA_NO_PLOT = "No plot window is focused, so there is nothing to put the Data window beside.";

const SOURCE = "windowLayout";

/** Cancel and Escape on the Reset question drop focus to <body> (its opener, a menu item or the palette,
 *  is gone), so a keyboard user starts again from the top (UX pass 5 m1): the focused plot window's
 *  title bar takes it, as after the confirm. Next frame: the dialog restores focus as it unmounts. */
function refocusPlot(reset: boolean): void {
  if (reset) return;
  requestAnimationFrame(() => {
    const plot = currentFocusedPlot();
    if (plot) focusTitleBar(plot);
  });
}

export function layoutCommands(): Action[] {
  return [
    {
      id: "layout-dock-all",
      group: "Window",
      section: "Arrange",
      label: "Dock all",
      description: "Dock the focused plot in the centre, Data, Style and Analysis on the right and analysis tools at the bottom.",
      run: dockAllWindows,
    },
    {
      id: "layout-float-all",
      group: "Window",
      section: "Arrange",
      label: "Float all",
      description: "Float every docked window at its own saved position.",
      run: floatAllWindows,
    },
    {
      id: "layout-tile-all",
      group: "Window",
      section: "Arrange",
      label: "Tile all",
      description: "Share the centre between every open window as an even grid.",
      run: tileAllWindows,
    },
    {
      id: "layout-plot-data",
      group: "Window",
      section: "Arrange",
      label: "Plot | Data side by side",
      description: PLOT_DATA_HINT,
      disabled: () => !canPlotBesideData(),
      disabledReason: PLOT_DATA_NO_PLOT,
      run: plotBesideDataWindows,
    },
    {
      id: "layout-reset",
      group: "Window",
      section: "Arrange",
      label: "Reset layout…",
      description: "Put every window back in its default place for this screen width (asks first; open windows stay open).",
      keywords: "default restore windows dock arrangement",
      // The status line says "done" (a live region); the layout region stays silent, so it is said once.
      run: () => void resetWindowLayout(() => holdAnnouncement("")).then(refocusPlot),
    },
    {
      id: "layout-toggle-analysis",
      group: "Window",
      section: "Windows",
      label: "Analysis window",
      description: "Open or close the Analysis window: the guide and every analysis tool for the focused plot.",
      keywords: "guide technique steps tools workflow",
      run: () => toggleWindow("analysis"),
    },
    {
      id: "layout-toggle-data",
      group: "Window",
      section: "Windows",
      label: "Data window",
      description: "Open or close the Data window: the worksheet of the focused plot.",
      run: () => toggleWindow("data"),
    },
  ];
}

export function useLayoutCommands(): void {
  useEffect(() => {
    const { setMenuCommands } = useCommands.getState();
    setMenuCommands(SOURCE, layoutCommands());
    return () => setMenuCommands(SOURCE, []);
  }, []);
}
