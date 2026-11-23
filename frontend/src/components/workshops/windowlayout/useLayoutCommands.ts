// The layout's arrange commands in the Window menu and the ⌘K palette
// (WORKSPACE_LAYOUT_PLAN D4), published while the host is mounted (windows
// mode only) through the shared command registry, the useWindowCommands
// pattern. "Plot | Data side by side" is listed but disabled until the Data
// window exists (plan P3), with that reason.

import { useEffect } from "react";

import { useCommands, type Action } from "../../../store/commands";
import { dockAllWindows, floatAllWindows, tileAllWindows } from "../../../store/windowLayoutActions";

/** Why Plot | Data is not available yet (also the toolbar button's tooltip). */
export const PLOT_DATA_PENDING = "The Data window arrives in a later preview release, so there is nothing to put beside the plot yet.";

const SOURCE = "windowLayout";

export function layoutCommands(): Action[] {
  return [
    {
      id: "layout-dock-all",
      group: "Window",
      section: "Arrange",
      label: "Dock all",
      description: "Dock the focused plot in the centre, Style on the right and analysis tools at the bottom.",
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
      disabled: () => true,
      disabledReason: PLOT_DATA_PENDING,
      run: () => undefined,
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
