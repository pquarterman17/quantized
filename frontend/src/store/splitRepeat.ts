// "Repeat last action" for a split: the same column and tolerance on every
// selected dataset. Registered by runSplit (the one place every split goes
// through, the dialog, the Reshape workshop and macro replay alike), but NOT
// while a pipeline is replaying: that is not something the user just did.
// Every selected dataset must have the column, else nothing is split.

import { rememberRepeat } from "../lib/lastAction";
import { replayRefusal } from "../lib/repeatGuards";
import type { SliceGet } from "./split";

export function rememberSplitRepeat(get: SliceGet, col: number, tolerance: number | undefined): void {
  if (get().pipelineRunning) return;
  rememberRepeat({
    label: "Split by column value",
    run: async () => {
      const st = get();
      const ids = st.selectedIds.length ? st.selectedIds : st.activeId ? [st.activeId] : [];
      if (ids.length === 0) throw new Error("select a dataset first");
      for (const id of ids) {
        const ds = st.datasets.find((d) => d.id === id);
        const why = ds && replayRefusal({ op: "split", col, tolerance: tolerance ?? null }, ds);
        if (why) throw new Error(`${why}; nothing was split`);
      }
      for (const id of ids) await get().splitDatasetByColumn(id, col, tolerance);
    },
  });
}
