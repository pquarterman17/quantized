// "Extract rows…": the worksheet's Extract with the question (ROW_RANGE_CONTRACT section 4). The one-click "Extract
// selected rows to a new sheet" is unchanged (the contract is silent on a question for the worksheet's own Extract, and
// an existing one-click flow gains no dialog); this variant sits beside it and asks, as the plot's "Create subset from
// region" does, which of the sheet's series go into the subset (each with the number of the rows that hold a value) and
// which workbook it lands in. Ticking everything and keeping the source's workbook is the one-click Extract.
// Loaded on demand from the worksheet's buttons and menus.

import type { AppState } from "../../../store/useApp";
import { describeExtract, planExtract } from "./extractRows";
import { selectedExtractRows } from "./extractRowsRun";
import { subsetWithChoices } from "../subsetWithChoices";

export async function extractRowsAsking(datasetId: string, selected: ReadonlySet<number>, get: () => AppState): Promise<void> {
  const s = get();
  const ds = s.datasets.find((d) => d.id === datasetId);
  if (!ds || selected.size === 0) return;
  // A selection made on a still-loading preview names preview rows, not source rows: ask again once the data is in.
  if (ds.pending) return s.setStatus(`“${ds.name}” is still loading: extract again in a moment`, "danger");
  const plan = planExtract(ds.data, selectedExtractRows(selected));
  if (!plan) return s.setStatus(describeExtract(plan, ds.data.time.length), "danger");
  await subsetWithChoices(get, ds, plan, ds.data.labels.map((_l, c) => c), false);
}
