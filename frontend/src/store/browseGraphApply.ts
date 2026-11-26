// The write behind Browse graph (lib/browseGraph.ts): one step of the focused
// graph's curve through its sheet's columns or through same-shaped sheets.
// Nothing here binds a curve itself: the step is `rebindCurve`, the one
// binding path (one undo step, style kept). Loaded on demand from the Plot
// menu commands, the Alt+Up/Down keys and the Graph browser window.

import { planBrowse, type BrowseBy } from "../lib/browseGraph";
import { fixedLim } from "../lib/axisLim";
import { rebindCurve } from "./curveRebindApply";
import { toast } from "./toasts";
import { useApp } from "./useApp";

/** Step the curve in visible place `slot` by `delta` (+1 next, -1 previous) through
 *  its sheet's columns or the sheets that carry its columns. True when the graph changed. */
export function browseGraph(by: BrowseBy, delta: 1 | -1, slot = 0): boolean {
  const s = useApp.getState();
  const plan = planBrowse(s, by, delta, slot);
  if (!plan.ok) {
    toast(plan.why, "danger");
    return false;
  }
  if (!rebindCurve(plan.channel, plan.expected, plan.to)) return false;
  const after = useApp.getState();
  // A range the user fixed stays fixed (their choice); say so when the new curve may fall outside it.
  const fixed = fixedLim(after.yLim) ? " — the Y range is fixed: press A to rescale" : "";
  after.setStatus(`${by === "column" ? "column" : "sheet"} ${plan.position} of ${plan.count}: ${plan.name}${fixed}`);
  return true;
}
