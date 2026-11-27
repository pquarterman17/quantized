// The gesture half of the worksheet's Extract (`useWorksheetView`'s `extractSubset` and
// `extractSelectedRows`): wait for a still-loading book, pick the rows against the FULL data,
// plan, and commit through the one shared path (`commitExtract`, which stamps
// `__quantized_source_rows`). The two entry points differ only in how they pick rows.

import type { Dataset } from "../../../lib/types";
import { resolvePendingEdit } from "../../../store/pendingEdit";
import type { useApp } from "../../../store/useApp";
import { describeExtract, planExtract } from "./extractRows";
import { commitExtract } from "./extractRowsCommit";

type Status = (message: string, tone?: "danger" | "ok") => void;
type Get = typeof useApp.getState;

/** Rows the selection extracts: the selected SOURCE rows, in source order (a gutter selection has no
 *  other meaningful order, and the child records which source rows it holds). */
export function selectedExtractRows(selected: ReadonlySet<number>): number[] {
  return [...selected].sort((a, b) => a - b);
}

/** Run an Extract. `pick` gets the dataset holding the full data and returns the rows to cut, or a
 *  string saying why it cannot (shown as the status). */
export function runExtract(ds: Dataset, pick: (source: Dataset) => number[] | string, setStatus: Status, get: Get): void {
  const apply = (source: Dataset) => {
    const rows = pick(source);
    if (typeof rows === "string") { setStatus(rows, "danger"); return; }
    const plan = planExtract(source.data, rows);
    const stopped = plan ? commitExtract(source, plan, (id) => get().datasets.find((d) => d.id === id)?.name) : null;
    if (stopped) { setStatus(stopped.status, stopped.tone); return; }
    setStatus(describeExtract(plan, source.data.time.length));
  };
  if (resolvePendingEdit(get, ds, "extracting rows", apply)) return;
  apply(ds);
}

/** "Extract selected rows to a new sheet". A selection made on a still-loading preview names preview
 *  rows, not source rows, so once the full data arrives the user selects again. */
export function extractSelectedRows(ds: Dataset, selected: ReadonlySet<number>, setStatus: Status, get: Get): void {
  if (selected.size === 0) return;
  runExtract(
    ds,
    (source) => source === ds
      ? selectedExtractRows(selected)
      : "The full data has loaded, but the selection was made on the preview: select the rows again, then extract",
    setStatus,
    get,
  );
}
