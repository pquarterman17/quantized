import { useEffect, useMemo, useState } from "react";

import { analysisTargetDataset, resolveAnalysisInputs, type AnalysisInputs, type AnalysisRowPolicy } from "../../../lib/analysisInputs";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { withTextGroupChannels } from "../../../lib/groupableColumns";
import { bookFetchSettled, lastBookError, truncateReason } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useRowRangeOf } from "./useRowRangeOf";
import { useApp } from "../../../store/useApp";

interface Options {
  selection?: AnalysisSelectionItem | null;
  followActive?: boolean;
  xKey?: number | null;
  yKeys?: readonly number[];
  /** The tool has no X axis: the summary omits it. */
  noX?: boolean;
  policy: AnalysisRowPolicy;
  /** False for a tool state that reads no data (do not request the full load). */
  load?: boolean;
  /** True for a group-by tool: CSV text columns join the channels as categorical ones
   *  (lib/groupableColumns), so a pick may name one. The resolved `dataset` and `data`
   *  then carry them; the store's dataset is untouched. */
  textGroups?: boolean;
}

/** Live `resolveAnalysisInputs` over the store. A lazy Origin preview is
 *  refused (never analysed) and its full load is requested here, so the
 *  refusal clears itself once the real rows land. If that load FAILS the
 *  refusal becomes "load-failed" with the recorded reason (lib/bookData's
 *  `lastBookError`), which a retry (Re-import / Relink) replaces. */
export function useAnalysisInputs({ selection, followActive = false, xKey, yKeys, noX, policy, load = true, textGroups = false }: Options): AnalysisInputs {
  // Memo on the TARGET dataset only: an edit to an unrelated worksheet must
  // not hand the tool a new `data` object (and a refetch).
  const target = useApp((state) => {
    const found = analysisTargetDataset(state.datasets, state.activeId, selection, followActive);
    return found && textGroups ? withTextGroupChannels(found) : found;
  });
  // A tool that consumes no selection item of its own (the statistics tools)
  // still honours a row range set on its worksheet in the shared analysis
  // selection (ROW_RANGE_CONTRACT 3.3): the resolver narrows it first.
  const setRange = useRowRangeOf(target?.id);
  // (Also under an `ignore` policy: the line then says the range is not applied.)
  const rowRange = selection ? null : setRange;
  const yKeyText = yKeys === undefined ? undefined : yKeys.join(",");
  const inputs = useMemo(
    () => resolveAnalysisInputs({
      datasets: target ? [target] : [], activeId: target?.id ?? null, selection, followActive, xKey, noX, policy, rowRange,
      yKeys: yKeyText === undefined ? undefined : yKeyText === "" ? [] : yKeyText.split(",").map(Number),
    }),
    [target, selection, followActive, xKey, noX, yKeyText, policy, rowRange],
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
