// Keeps the layout in step with the project while the host is mounted
// (WORKSPACE_LAYOUT_PLAN P1):
// - windows mode with no layout (a project opened without one, Remove all, a
//   failed restore) re-seeds one from the classic desk, through the slice's
//   own `setLayoutMode`, which seeds only when the layout is null;
// - a plot window created while the layout is on gets a placement (its
//   default slot, the centre: `reopen` of a never-placed window), and one that
//   is gone loses its placement (`pruneRefs`);
// - the two classic WindowCanvas upkeep jobs, which that component runs only
//   while it is mounted: fetch a lazy Origin book's data for every visible
//   window, and hydrate the focused window at once while pruning closed ones
//   from the staged-restore queue.

import { useEffect } from "react";

import { pruneRefs, reopen } from "../../../lib/windowLayout/ops";
import { kindOf, plotRef } from "../../../lib/windowLayout/refs";
import { useApp } from "../../../store/useApp";
import { forceHydrate, pruneHydration } from "../../../store/windowHydration";
import { plotWindowDatasetId } from "../../../store/windowDocuments";

export function useLayoutSync(): void {
  const layout = useApp((s) => s.windowLayout);
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const focusedWindowId = useApp((s) => s.focusedWindowId);
  const setWindowLayout = useApp((s) => s.setWindowLayout);
  const setLayoutMode = useApp((s) => s.setLayoutMode);
  const ensureBookData = useApp((s) => s.ensureBookData);

  useEffect(() => {
    if (!layout) {
      void setLayoutMode("windows");
      return;
    }
    const ids = new Set(plotWindows.map((w) => plotRef(w.id)));
    let next = pruneRefs(layout, (r) => kindOf(r) !== "plot" || ids.has(r));
    for (const w of plotWindows) if (!next.placements[plotRef(w.id)]) next = reopen(next, plotRef(w.id));
    if (next !== layout) setWindowLayout(next);
  }, [layout, plotWindows, setWindowLayout, setLayoutMode]);

  useEffect(() => {
    for (const win of plotWindows) {
      const id = plotWindowDatasetId(win);
      if (win.winState === "minimized" || !id) continue;
      const ds = datasets.find((d) => d.id === id);
      if (ds?.pending) ensureBookData(ds.id);
    }
  }, [plotWindows, datasets, ensureBookData]);

  useEffect(() => {
    if (focusedWindowId) forceHydrate(focusedWindowId);
    pruneHydration(new Set(plotWindows.map((w) => w.id)));
  }, [focusedWindowId, plotWindows]);
}
