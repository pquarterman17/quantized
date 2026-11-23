// Keeps the layout in step with the project while the host is mounted
// (WORKSPACE_LAYOUT_PLAN P1):
// - windows mode with no layout (a project opened without one, Remove all, a
//   failed restore) re-seeds one from the classic desk, through the slice's
//   own `setLayoutMode`, which seeds only when the layout is null;
// - a plot window created while the layout is on gets a placement (its
//   default slot, the centre: `reopen` of a never-placed window), and one that
//   is gone loses its placement (`pruneRefs`);
// - a tool window whose tool is not open closes (its placement is kept);
// - the two classic WindowCanvas upkeep jobs, which that component runs only
//   while it is mounted: fetch a lazy Origin book's data for every visible
//   window, and hydrate the focused window at once while pruning closed ones
//   from the staged-restore queue.

import { useEffect } from "react";

import { close, pruneRefs, reopen } from "../../../lib/windowLayout/ops";
import { kindOf, plotRef, toolRef } from "../../../lib/windowLayout/refs";
import { firstToolOpen } from "../../../store/layoutToolActions";
import { useLayoutTools } from "../../../store/layoutTools";
import { applyLayout } from "../../../store/windowLayoutActions";
import { useApp } from "../../../store/useApp";
import { forceHydrate, pruneHydration } from "../../../store/windowHydration";
import { plotWindowDatasetId } from "../../../store/windowDocuments";

export function useLayoutSync(): void {
  const layout = useApp((s) => s.windowLayout);
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const focusedWindowId = useApp((s) => s.focusedWindowId);
  const setLayoutMode = useApp((s) => s.setLayoutMode);
  const ensureBookData = useApp((s) => s.ensureBookData);
  const tools = useLayoutTools();

  useEffect(() => {
    if (!layout) {
      void setLayoutMode("windows");
      return;
    }
    const ids = new Set(plotWindows.map((w) => plotRef(w.id)));
    // On the LIVE layout, not the render's copy: ToolWindowsSync has just opened a tool's window in a layout
    // effect, and writing back a copy from before that would undo it (a tool that floated on a small
    // screen came back docked under the floating plot; UX pass 3, B2).
    applyLayout((live) => {
      let next = pruneRefs(live, (r) => kindOf(r) !== "plot" || ids.has(r));
      for (const w of plotWindows) if (!next.placements[plotRef(w.id)]) next = reopen(next, plotRef(w.id));
      // A tool window is open exactly while its tool is (a restored project's open tool placement whose tool is
      // closed closes, keeping its slot for next time; the tool reopens it when it mounts, LayoutToolWindow).
      for (const r of Object.keys(next.placements) as (keyof typeof next.placements)[]) {
        if (kindOf(r) === "tool" && next.placements[r]?.open && !tools.has(r.slice(5))) next = close(next, r);
      }
      // A tool that mounted before this layout existed (a re-seed) gets its window now.
      for (const id of tools.keys()) if (!next.placements[toolRef(id)]) next = firstToolOpen(next, id);
      return next;
    });
  }, [layout, plotWindows, tools, setLayoutMode]);

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
