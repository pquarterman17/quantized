import { analysisTargetDataset } from "../../../lib/analysisInputs";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";

/** Reactive bridge from the shared analysis contract to the Peaks hook. */
export function usePeakAnalysisSelection() {
  const fallbackActive = useActiveDataset();
  const analysisSelection = useToolAnalysisSelection("peaks");
  const datasets = useApp((state) => state.datasets);
  const selected = analysisSelection?.items[0] ?? null;
  // Shared precedence (lib/analysisInputs): a deleted handoff worksheet is refused, never swapped.
  const active = analysisTargetDataset(datasets, fallbackActive?.id ?? null, selected, analysisSelection?.source === "tool-default");
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
