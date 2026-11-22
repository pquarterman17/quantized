import { useEffect, useMemo, useState } from "react";

import { analysisTargetDataset, resolveAnalysisInputs, type AnalysisInputs, type AnalysisRowPolicy } from "../../../lib/analysisInputs";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { bookFetchSettled, lastBookError, truncateReason } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

interface Options {
  selection?: AnalysisSelectionItem | null;
  followActive?: boolean;
  xKey?: number | null;
  yKeys?: readonly number[];
  policy: AnalysisRowPolicy;
  /** False for a tool state that reads no data (do not request the full load). */
  load?: boolean;
}

/** Live `resolveAnalysisInputs` over the store. A lazy Origin preview is
 *  refused (never analysed) and its full load is requested here, so the
 *  refusal clears itself once the real rows land. If that load FAILS the
 *  refusal becomes "load-failed" with the recorded reason (lib/bookData's
 *  `lastBookError`), which a retry (Re-import / Relink) replaces. */
export function useAnalysisInputs({ selection, followActive = false, xKey, yKeys, policy, load = true }: Options): AnalysisInputs {
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
  const pendingDataset = !inputs.ok && inputs.code === "pending" ? inputs.dataset : null;
  // The dataset OBJECT whose load last failed: a relinked or re-imported book
  // is a new object, so the failure does not outlive it.
  const [failed, setFailed] = useState<{ dataset: Dataset; reason: string } | null>(null);
  useEffect(() => {
    if (!load || !pendingDataset?.pending) return;
    // ensureBookData is single-flight and idempotent.
    ensureBookData(pendingDataset.id);
    const { id, pending } = pendingDataset;
    let live = true;
    const check = () => {
      const reason = lastBookError(id, pending);
      if (live && reason !== null) setFailed({ dataset: pendingDataset, reason });
    };
    // No fetch registered (it already settled): read the recorded failure now.
    const settled = bookFetchSettled(id, pending);
    if (settled) void settled.then(check);
    else check();
    return () => { live = false; };
  }, [pendingDataset, ensureBookData, load]);
  if (pendingDataset && failed?.dataset === pendingDataset) {
    return {
      ...inputs as Extract<AnalysisInputs, { ok: false }>,
      code: "load-failed",
      reason: `The full worksheet could not be loaded (${truncateReason(failed.reason)}); its preview rows are not analysed. Re-import or relink the source.`,
    };
  }
  return inputs;
}
