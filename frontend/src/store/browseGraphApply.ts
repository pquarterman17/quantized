// The write behind Browse graph (lib/browseGraph.ts): one step of the focused
// graph's curve through its sheet's columns or through same-shaped sheets.
// Nothing here binds a curve itself: the step is `rebindCurve`, the one
// binding path (one undo step, style kept). Loaded on demand from the Plot
// menu commands, the Alt+Up/Down keys and the Graph browser window.

import { planBrowse, type BrowseBy } from "../lib/browseGraph";
import { layerIndexOf, planBrowseGroup, type GroupPlan } from "../lib/browseGroup";
import { fixedLim } from "../lib/axisLim";
import { rebindCurve } from "./curveRebindApply";
import { rememberedSize, useBrowseSettings } from "./browseSettings";
import { applyLayerContents, layerCurvesOf } from "./layerContentsApply";
import { toast } from "./toasts";
import { useApp } from "./useApp";

/** The plan of the next step: the group path when several curves are shown (or were by the last step), else the
 *  single-curve one. The panel reads it for its buttons; `browseGraph` applies it. */
export function planStep(by: BrowseBy, delta: 1 | -1, slot = 0, n = useBrowseSettings.getState().perStep): GroupPlan | ReturnType<typeof planBrowse> {
  const s = useApp.getState();
  const layer = s.activeId ? layerCurvesOf(s, s.activeId) : [];
  const remembered = rememberedSize(s.activeId, layerIndexOf(s, layer, slot));
  return n > 1 || remembered > 1 ? planBrowseGroup(s, layer, by, delta, slot, n, remembered) : planBrowse(s, by, delta, slot);
}

/** Step the curve in visible place `slot` by `delta` (+1 next, -1 previous) through
 *  its sheet's columns or the sheets that carry its columns; with several curves per step,
 *  the group of curves from that place. True when the graph changed. */
export function browseGraph(by: BrowseBy, delta: 1 | -1, slot = 0): boolean {
  const plan = planStep(by, delta, slot);
  if (!plan.ok) {
    toast(plan.why, "danger");
    return false;
  }
  const grouped = "group" in plan;
  if (grouped ? !applyLayerContents(useApp.getState().activeId!, plan.rows) : !rebindCurve(plan.channel, plan.expected, plan.to)) return false;
  // A legend the user typed stays on its place (the apply forgets the text of a re-bound column).
  if (grouped && plan.legends.length > 0) {
    useApp.setState((st) => ({ seriesLabels: { ...st.seriesLabels, ...Object.fromEntries(plan.legends.map((l) => [plan.index + l.k, l.text])) } }));
  }
  const after = useApp.getState();
  // A live graph's curve at `slot` is its layer slot `index`; a plain graph's step made it live, with the same slots.
  const index = grouped ? plan.index : layerIndexOf(after, layerCurvesOf(after, after.activeId ?? ""), slot);
  useBrowseSettings.setState({ group: after.activeId ? { graphId: after.activeId, index, size: grouped ? plan.width : 1 } : null });
  // A range the user fixed stays fixed (their choice); say so when the new curve may fall outside it.
  const fixed = fixedLim(after.yLim) ? " — the Y range is fixed: press A to rescale" : "";
  const what = by === "column" ? (grouped && plan.width > 1 ? "columns" : "column") : "sheet";
  after.setStatus(`${what} ${plan.position} of ${plan.count}: ${plan.name}${fixed}`);
  return true;
}
