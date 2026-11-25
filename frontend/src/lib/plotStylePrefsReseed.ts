// Re-seed the live (focused-window) plot view from Preferences once the server
// prefs file has been applied (PREFS_AUDIT P1-5). The store's singleton view
// fields are created at module load, BEFORE the server answers, so a Grid /
// legend / tick default held only on the server file would otherwise miss the
// first plot of the session. Only a blank workspace is touched: once a dataset
// or a window exists the view is the user's, never silently re-seeded.
// Lazy (imported by prefsServerSync only).

import { useApp } from "../store/useApp";
import { plotStyle } from "./plotStylePrefs";

/** True when the seed ran (a blank workspace). */
export function reseedPlotViewDefaults(): boolean {
  const s = useApp.getState();
  if (s.datasets.length > 0 || s.plotWindows.length > 0) return false;
  useApp.setState({ showGrid: plotStyle.grid, legendPos: plotStyle.legend, xFmt: { ...plotStyle.fmt }, yFmt: { ...plotStyle.fmt } });
  return true;
}
