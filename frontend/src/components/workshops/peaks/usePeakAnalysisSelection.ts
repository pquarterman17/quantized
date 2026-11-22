import { analysisTargetDataset } from "../../../lib/analysisInputs";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";

/** Reactive bridge from the shared analysis contract to the Peaks hook. */
export function usePeakAnalysisSelection() {
  const fallbackActive = useActiveDataset();
  const analysisSelection = useToolAnalysisSelection("peaks");
  const datasets = useApp((state) => state.datasets);
  const item = analysisSelection?.items[0] ?? null;
  // Shared precedence (lib/analysisInputs): a deleted handoff worksheet is
  // refused, never swapped; a live capture that follows the active sheet
  // never applies the deleted sheet's roles or rows to it.
  const active = analysisTargetDataset(datasets, fallbackActive?.id ?? null, item, analysisSelection?.source === "tool-default");
  const selected = item && item.datasetId === active?.id ? item : null;
  const liveXKey = useApp((state) => state.xKey);
  const liveYKeys = useApp((state) => state.yKeys);
  return {
    active,
    activeId: active?.id ?? null,
    selected,
    xKey: selected?.xKey ?? liveXKey,
    yKeys: selected?.yKeys ?? liveYKeys,
    seriesOrder: useApp((state) => state.seriesOrder),
  };
}
