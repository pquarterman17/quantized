import { useEffect, useRef } from "react";

import type { AnalysisSelection } from "../../../lib/analysisSelection";
import { seedAnalysisSelection, useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";

/** Return only a seed owned by this tool. A direct menu/shortcut launch gets a
 * fresh snapshot on mount; an Analysis Center launch keeps its reviewed seed. */
export function useToolAnalysisSelection(toolId: string): AnalysisSelection | null {
  const owner = useAnalysisSelection((state) => state.toolId);
  const selection = useAnalysisSelection((state) => state.selection);
  // A direct launch is a live projection of the plot/Library selection, not a
  // reviewed frozen handoff. Keep only the inputs that affect capture in this
  // signature: peak overlays, fit results, annotations, and other app writes
  // must not continuously replace the contract while a tool is running.
  const captureSignature = useApp((state) => JSON.stringify({
    activeId: state.activeId,
    selectedIds: state.selectedIds,
    xKey: state.xKey,
    yKeys: state.yKeys,
    seriesOrder: state.seriesOrder,
    errKeys: state.errKeys,
    selection: state.selection,
    qfitRoi: state.qfitRoi,
    qfitRoiFor: state.qfitRoiFor,
    integral: state.integral,
    mapRoi: state.mapRoi,
    mapRuler: state.mapRuler,
    mapSector: state.mapSector,
    datasets: state.datasets.map((dataset) => ({
      id: dataset.id,
      width: dataset.data.labels.length,
      channelRoles: dataset.channelRoles,
      errorRoles: dataset.errorRoles,
    })),
  }));
  const initialized = useRef(false);
  useEffect(() => {
    const current = useAnalysisSelection.getState();
    if (!initialized.current) {
      // A direct-launch seed is only valid for that panel mount. Reopening a
      // tool must snapshot today's plot/rows, while explicit Analysis Center,
      // worksheet, and rerun handoffs survive the mount that consumes them.
      if (current.toolId !== toolId || !current.selection || current.selection.source === "tool-default") {
        seedAnalysisSelection(toolId, "tool-default");
      }
      initialized.current = true;
    } else if (current.toolId === toolId && current.selection?.source === "tool-default") {
      // Preserve old direct-tool behavior: changing worksheet or plotted roles
      // while the panel is open immediately changes what the next run means.
      seedAnalysisSelection(toolId, "tool-default");
    }
  }, [captureSignature, toolId]);
  return owner === toolId ? selection : null;
}
