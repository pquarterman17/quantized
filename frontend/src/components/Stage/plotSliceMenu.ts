// The data-slicer entries of the plot's right-click menu (gap plan item 22): after a
// Select rows drag, act on the rectangle. Keep only and Exclude (plotMenu's own entry)
// work on the selected rows; Extract copies them to a new sheet; "Use the box as a
// data filter" turns the painted rectangle into an editable Data Filter. The bodies
// load on demand.

import type uPlot from "uplot";

import { planSliceFilter, sliceBoxOf } from "../../lib/plotSlice";
import type { PlotPayload } from "../../lib/plotdata";
import { onLoadFailure, runLazy } from "../../lib/runLazy";
import { toast } from "../../store/toasts";
import { useApp, type AppState } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

const load = () => runLazy("Working on points…", () => import("./plotSliceApply"));

/** The entries for the focused plot `u` under the Select rows tool; empty when there is nothing to slice. */
export function sliceItems(u: uPlot | null, st: AppState, payload: PlotPayload, selected: number): ContextMenuItem[] {
  if (st.plotTool !== "select") return [];
  const box = u ? sliceBoxOf(u, (st.y2Keys?.length ?? 0) > 0) : null;
  const items: ContextMenuItem[] = [];
  if (selected > 0) {
    items.push({ label: `Keep only selected points (${selected})`, title: "Mask every other point of this sheet (Undo restores them)", run: () => st.keepOnlySelectedRows() });
    items.push({
      label: `Create subset from region (${selected} point${selected === 1 ? "" : "s"})`,
      title: "Copy these points' rows to a new sheet beside the source, linked back to them (Go to Source on the new sheet selects them again)",
      run: () => void load().then((m) => m.createSubsetFromRegion(useApp.getState), onLoadFailure),
    });
  }
  if (box) {
    items.push({
      label: box.y ? "Use the box as a data filter (X and Y)" : "Use the band as a data filter (X)",
      title: "Limit the plotted data to this window with an ordinary Data Filter, which the Data Filter window edits",
      run: () => {
        const sliced = planSliceFilter(st, box, payload);
        if (!sliced.plan.ok) return toast(sliced.plan.why, "danger");
        void load().then((m) => m.applyBoxFilter(sliced, useApp.getState), onLoadFailure);
      },
    });
  }
  return items.length ? [...items, { separator: true }] : items;
}
