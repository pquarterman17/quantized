import { useActiveDataset, useApp } from "../../../store/useApp";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";

/** Reactive bridge from the shared analysis contract to the Peaks hook. */
export function usePeakAnalysisSelection() {
  const fallbackActive = useActiveDataset();
  const analysisSelection = useToolAnalysisSelection("peaks");
  const datasets = useApp((state) => state.datasets);
  const selected = analysisSelection?.items[0] ?? null;
  const active = (selected ? datasets.find((dataset) => dataset.id === selected.datasetId) : null) ?? fallbackActive;
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
