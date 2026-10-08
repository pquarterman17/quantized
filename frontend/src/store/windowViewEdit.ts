// An edit made ON a background (unfocused) plot window, written to that
// window's own view rather than the live singleton fields the focused window
// owns. Today only the magnifier inset edits in place (`Stage/InsetPlot.tsx`:
// focusing swaps the window's content, which used to unmount the inset
// mid-gesture and drop the edit). Undoable like every view edit: `history`
// labels the step (plotWindows is in the history snapshot). Imported only by
// lazy code.

import type { PlotView } from "../lib/plotview";
import { useApp } from "./useApp";
import { plotWindowView, syncPlotWindow } from "./windowDocuments";

/** Merge `patch` into background plot window `id`'s view. A no-op for the
 *  focused window (its view is the live store) or an unknown id. */
export function patchBackgroundView(id: string, patch: Partial<PlotView>, history?: string): void {
  const s = useApp.getState();
  const win = s.plotWindows.find((w) => w.id === id);
  if (!win || win.kind !== "plot" || id === s.focusedWindowId) return;
  if (history) s.recordHistory(history);
  useApp.setState((st) => ({
    plotWindows: st.plotWindows.map((w) => (w.id === id ? syncPlotWindow(w, { ...plotWindowView(w), ...patch }) : w)),
  }));
}
