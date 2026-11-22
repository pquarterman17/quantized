// The FOCUSED plot window's own chrome for PlotStage, which always renders the
// focused window (the sole maximized default, or the focused frame inside an
// MDI canvas -- see WindowCanvas), so these are looked up by the CURRENT
// focusedWindowId rather than threaded in as props. Each is a derived
// primitive selector: a re-render only when the RESULT changes, never on a
// `plotWindows` array-identity change.
//  - Item 18: the per-window background override (`bg`).
//  - Item 13: the cross-window link groups, which PlotStage resolves to the
//    uPlot sync keys (or undefined = unlinked) for PlotViewport.

import { useApp } from "../../store/useApp";

export function useFocusedWindowChrome() {
  const bg = useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.bg);
  const linkGroup = useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.linkGroup ?? null);
  const linkYGroup = useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.linkYGroup ?? null);
  return { bg, linkGroup, linkYGroup };
}
