import { useEffect, useMemo } from "react";

import { analysisTargetDataset, resolveAnalysisInputs, type AnalysisInputs, type AnalysisRowPolicy } from "../../../lib/analysisInputs";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { useApp } from "../../../store/useApp";

interface Options {
  selection?: AnalysisSelectionItem | null;
  followActive?: boolean;
  xKey?: number | null;
  yKeys?: readonly number[];
  policy: AnalysisRowPolicy;
}

/** Live `resolveAnalysisInputs` over the store. A lazy Origin preview is
 *  refused (never analysed) and its full load is requested here, so the
 *  refusal clears itself once the real rows land. */
export function useAnalysisInputs({ selection, followActive = false, xKey, yKeys, policy }: Options): AnalysisInputs {
  // Memo on the TARGET dataset only: an edit to an unrelated worksheet must
  // not hand the tool a new `data` object (and a refetch).
  const target = useApp((state) => analysisTargetDataset(state.datasets, state.activeId, selection, followActive));
  const yKeyText = yKeys === undefined ? undefined : yKeys.join(",");
  const inputs = useMemo(
    () => resolveAnalysisInputs({
      datasets: target ? [target] : [], activeId: target?.id ?? null, selection, followActive, xKey, policy,
      yKeys: yKeyText === undefined ? undefined : yKeyText === "" ? [] : yKeyText.split(",").map(Number),
    }),
    [target, selection, followActive, xKey, yKeyText, policy],
  );
  const ensureBookData = useApp((state) => state.ensureBookData);
  const pendingId = !inputs.ok && inputs.code === "pending" ? inputs.dataset?.id ?? null : null;
  useEffect(() => {
    // ensureBookData is single-flight and idempotent.
    if (pendingId) ensureBookData(pendingId);
  }, [pendingId, ensureBookData]);
  return inputs;
}
