// Go to Source and Reopen in tool on a saved result's RECORDED row range (the pure half: lib/recordedRangeNav.ts).
// Lazy: reached from the result panel and the reopen paths only.

import type { AnalysisResult } from "../lib/analysisResult";
import { planRecordedRanges, type RecordedRangePlan } from "../lib/recordedRangeNav";
import { rowRangeLabel } from "../lib/rowRange";
import { useAnalysisSelection } from "./analysisSelection";
import { useApp } from "./useApp";
import { openWorksheet } from "./worksheetOpen";

type Okay = Extract<RecordedRangePlan, { ok: true }>;

/** Select the recorded rows of one plan in its source worksheet (the same open-with-rows path as every Go to Source). */
export function goToRecordedRows(plan: Okay): void {
  openWorksheet({ datasetId: plan.datasetId, rowIds: plan.rows });
  useApp.getState().setStatus(`selected ${rowRangeLabel(plan.range)} of “${plan.sourceName}”, the rows this result read when it was saved`);
}

const APPLY_WAIT_MS = 1500;

/** Put the recorded windows on the shared analysis selection once the reopened tool has seeded it. The tool seeds its
 *  selection when it mounts, which replaces whatever was held, so a window set before that would be lost: wait for the
 *  selection to change, and if it never does (a tool already holding its own) apply to the held one. Says so when it
 *  could not. */
function applyWhenSeeded(plans: readonly Okay[]): void {
  const before = useAnalysisSelection.getState().selection;
  let finished = false;
  let unsubscribe = (): void => undefined;
  let applying = false; // updateItem notifies the subscriber below: do not apply again from inside it
  const tryApply = (): boolean => {
    const { selection, updateItem } = useAnalysisSelection.getState();
    if (applying || !selection || !plans.every((p) => selection.items.some((item) => item.datasetId === p.datasetId))) return false;
    applying = true;
    try {
      for (const p of plans) updateItem(p.datasetId, { rowRange: { from: p.range.from, to: p.range.to } });
    } finally {
      applying = false;
    }
    return true;
  };
  const timer = setTimeout(() => finish(tryApply()), APPLY_WAIT_MS);
  function finish(applied: boolean): void {
    if (finished) return;
    finished = true;
    unsubscribe();
    clearTimeout(timer);
    if (!applied) useApp.getState().setStatus("the tool did not take the recorded rows: set them in its Input rows", "danger");
  }
  unsubscribe = useAnalysisSelection.subscribe((state) => {
    if (!finished && state.selection !== before && tryApply()) finish(true);
  });
}

/** Run `open` (the tool opener) for `result` on its RECORDED rows. Nothing is opened, and the status says why, when
 *  a recorded range cannot be honoured (the source changed since the save): a tool reopened without its window
 *  would compute on rows the result never read. A result that recorded no range just opens. Returns whether it opened. */
export function reopenOnRecordedRows(result: AnalysisResult, outputMetadata: Readonly<Record<string, unknown>> | undefined, open: () => boolean | void): boolean {
  const s = useApp.getState();
  const plans = planRecordedRanges(result, outputMetadata, s.datasets);
  const refused = plans.find((p) => !p.ok);
  if (refused && !refused.ok) {
    s.setStatus(`Reopen in tool: ${refused.reason}`, "danger");
    return false;
  }
  if (open() === false) return false;
  const oks = plans.filter((p): p is Okay => p.ok);
  if (oks.length) {
    applyWhenSeeded(oks);
    useApp.getState().setStatus(`reopened on the recorded ${oks.map((p) => `${rowRangeLabel(p.range)} of “${p.sourceName}”`).join("; ")} (when saved), not the live row range`);
  }
  return true;
}
