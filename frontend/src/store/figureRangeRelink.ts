// "Re-link to range" for a FROZEN saved figure made from a named range (lib/figureRangeFrozen.ts). It becomes a LIVE
// figure bound to the range's worksheet that follows the range again (store/rangeLinkSync.ts), as one undo step. Lazy:
// reached from the Library's context menu only.

import { relinkPlan } from "../lib/figureRangeFrozen";
import { resolveRangeLink } from "../lib/rangeLink";
import { installRangeLinkSync } from "./rangeLinkSync";
import { useApp } from "./useApp";

export type RelinkResult = { ok: true } | { ok: false; reason: string };

export function relinkFigureToRange(figureId: string): RelinkResult {
  const s = useApp.getState();
  const doc = s.editableFigures.find((d) => d.id === figureId);
  const fail = (reason: string): RelinkResult => {
    s.setStatus(`Re-link to range: ${reason}`, "danger");
    return { ok: false, reason };
  };
  if (!doc) return fail("that figure no longer exists");
  const plan = relinkPlan(doc, s.namedRanges, s.datasets, s.plotWindows.some((w) => w.kind === "plot" && w.document?.id === doc.id));
  if (!plan.ok) return fail(plan.reason);
  const link = resolveRangeLink(plan.range.id, plan.dataset.id, s.namedRanges, s.datasets);
  if (link.refused !== undefined) return fail(link.refused);
  s.recordHistory("re-link figure to range");
  const live = { ...doc, bindings: { ...doc.bindings, datasetId: plan.dataset.id }, data: { mode: "live" as const }, plot: { ...doc.plot, view: { ...doc.plot.view, rowRange: link } } };
  useApp.setState((st) => ({ editableFigures: st.editableFigures.map((d) => (d.id === doc.id ? live : d)) }));
  installRangeLinkSync();
  useApp.getState().setStatus(`"${doc.name}" follows named range ${plan.range.name} again (${plan.dataset.name}); its frozen data was replaced by the live worksheet. Undo restores it`);
  return { ok: true };
}
