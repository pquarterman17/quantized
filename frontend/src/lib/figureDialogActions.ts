// The figures-audit dialogs' store reads and commits (#6 Axis dialog, #8
// plot-type gallery), kept out of the components so they stay selector-only
// in render (architecture.test.ts's getState()-in-render ratchet). Only the
// lazy FigureDialogs chunk imports this module.

import type { AxisId } from "../store/figureDialogs";
import { useApp } from "../store/useApp";
import { axisDraft, axisPatch, type AxisDraft } from "./axisDialogModel";
import { PLOT_TYPES, plotTypePatch, plotTypeUnavailable, type PlotTypeId } from "./plotTypes";
import { effectiveChannels } from "./plotdata";

const AXIS_NAMES: Record<AxisId, string> = { x: "X axis", y: "Y axis", y2: "Y2 (right) axis" };

/** The live view's settings for `axis`, as an editable draft. */
export function currentAxisDraft(axis: AxisId): AxisDraft {
  return axisDraft(useApp.getState(), axis);
}

/** Commit an edited (valid) draft as ONE undo step. */
export function commitAxisDraft(axis: AxisId, draft: AxisDraft): void {
  const s = useApp.getState();
  s.recordHistory(`edit ${AXIS_NAMES[axis]}`);
  useApp.setState(axisPatch(s, axis, draft));
}

/** Switch the focused graph to plot type `id` (one undo step). */
export function applyPlotType(id: PlotTypeId): void {
  const s = useApp.getState();
  const dataset = s.datasets.find((d) => d.id === s.activeId) ?? null;
  if (plotTypeUnavailable(id, dataset) || !dataset) return;
  const label = PLOT_TYPES.find((t) => t.id === id)?.label ?? id;
  if (id === "contour") {
    s.setContourOn(true);
    s.setStageTab("map");
    s.setStatus(`plot type: ${label}`);
    return;
  }
  const plotted = effectiveChannels(dataset.data, s.yKeys, s.xKey, dataset.channelRoles, s.seriesOrder);
  s.recordHistory(`plot type: ${label.toLowerCase()}`);
  useApp.setState({ ...plotTypePatch(id, s, plotted), stageTab: "plot" });
  s.setStatus(`plot type: ${label}`);
}
