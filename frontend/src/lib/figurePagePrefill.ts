// Plot > Multi-panel export… used to open on an empty grid even with a plot window in front, so a
// one-file two-panel figure took a source click first (acceptance pass 6 usability 3, pass 7 usability 5).
// A panel is a whole plot WINDOW and one window fills one slot (`assignSlot` moves, never copies), so a
// second panel from the same file needs a second window: `duplicateWindow` makes it ("Add this plot
// again" in the composer).

import { displayedWindowTitle } from "./plotWindows";
import type { PlotWindow } from "./plotview";
import type { PanelSource } from "./figurepageActions";

interface Fronted {
  plotWindows: readonly PlotWindow[];
  focusedWindowId: string | null;
  datasets: readonly { id: string; name: string }[];
}

/** The plot window in front, as a panel source; null when none is (a worksheet, snapshot or map window
 *  in front is not a plot, nor is a plot with no dataset). */
export function frontPlotSource(s: Fronted): PanelSource | null {
  const win = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  if (!win || win.kind !== "plot" || win.datasetId === null) return null;
  return { kind: "window", id: win.id, name: displayedWindowTitle(win, s.datasets) };
}
