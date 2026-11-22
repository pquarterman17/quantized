// Lane RPL's pre-commit check, shared by every reopenable tool: would the NEW
// computation's columns break what is bound to the old output worksheet? The
// verdict (store/analysisOutputLayout.ts) is computed here from the live state
// and published on the session, so the banner shows it and Replace turns into
// Add as new; the commit checks it again at commit time. A tool that builds its
// table before the commit button (a batch table, a trend) passes its labels;
// one that computes and commits in one step is only checked at commit time.

import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { outputLayoutVerdict } from "../../../store/analysisOutputLayout";
import { useToolReopen } from "../../../store/toolReopen";
import { useApp } from "../../../store/useApp";

export function useReplaceLayoutBlock(tool: string | undefined, sourceId: string | undefined, newLabels: readonly string[] | null): void {
  // The reopened result, whichever mode is chosen: the reason must stay visible while "Add as new" is picked.
  const checkId = useToolReopen((s) => (tool && sourceId && s.sessions[tool]?.sourceId === sourceId ? s.sessions[tool]?.resultId : undefined));
  // Only the slices the verdict reads, so unrelated store updates (pan, zoom, status) do not rescan.
  const slices = useApp(useShallow((s) => ({
    datasets: s.datasets, plotWindows: s.plotWindows, layers: s.layers, activeId: s.activeId, editableFigures: s.editableFigures,
    figureDocs: s.figureDocs, savedPlotSpecs: s.savedPlotSpecs, analysisResults: s.analysisResults, xKey: s.xKey, yKeys: s.yKeys,
    y2Keys: s.y2Keys, groupKey: s.groupKey, facetKey: s.facetKey, errKeys: s.errKeys,
  })));
  const layoutReason = useMemo(() => {
    const outputId = checkId && slices.analysisResults.find((result) => result.id === checkId)?.outputs[0]?.datasetId;
    if (!outputId || !newLabels || !checkId) return null;
    const verdict = outputLayoutVerdict(slices, outputId, newLabels, checkId);
    return verdict.ok ? null : verdict.reason;
  }, [slices, newLabels, checkId]);
  const setLayoutBlocked = useToolReopen((s) => s.setLayoutBlocked);
  useEffect(() => {
    if (!tool) return undefined;
    setLayoutBlocked(tool, layoutReason);
    // Cleared when the request goes away (settings invalidated) or the tool closes.
    return () => setLayoutBlocked(tool, null);
  }, [tool, layoutReason, setLayoutBlocked]);
}
