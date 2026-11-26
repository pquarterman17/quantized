// Sort Columns by a label row: pick the row (Long Name, Units, Comments or a
// user parameter) and the direction through the shared ParamDialog; the order
// is built by lib/sortColumnsByLabel.ts and applied as one undo step by
// store/sortColumnsByLabel.ts. With several columns selected only
// those are sorted, among the slots they occupy; otherwise every value column.

import type { LabelKey } from "../../../lib/sortColumnsByLabel";
import type { Dataset } from "../../../lib/types";
import { noteDialog } from "../../../lib/dialogReopen";
import { userParamRows } from "../../../lib/userParams";
import { sortColumnsByLabel } from "../../../store/sortColumnsByLabel";
import { askParams } from "../../overlays/ParamDialog";

const BUILTIN: [string, LabelKey][] = [
  ["Long Name", { kind: "name" }],
  ["Units", { kind: "unit" }],
  ["Comments", { kind: "comment" }],
];
const DIRS = ["Ascending", "Descending"];
const PARAM = "Parameter: ";

/** Sort the value columns of `ds` (or just `targets`, when several) by a label row. */
export async function sortColumnsDialog(ds: Dataset, targets: readonly number[]): Promise<void> {
  noteDialog("Sort columns by label", ds, targets, sortColumnsDialog);
  const params = userParamRows(ds.data).map((r) => r.name);
  const options = [...BUILTIN.map(([l]) => l), ...params.map((n) => `${PARAM}${n}`)];
  const some = targets.length > 1;
  const p = await askParams(
    "Sort columns by label",
    [
      { key: "row", label: "Label row", type: "select", options, default: options[0] },
      { key: "dir", label: "Order", type: "select", options: DIRS, default: DIRS[0] },
    ],
    {
      confirmLabel: "Sort",
      message: `${some ? `Reorders the ${targets.length} selected columns among the places they hold` : "Reorders the value columns (the X column stays first)"}. Equal labels keep their order; columns with a blank label go last. One undo step.`,
    },
  );
  if (!p) return;
  const row = String(p.row);
  const key: LabelKey = row.startsWith(PARAM) ? { kind: "param", name: row.slice(PARAM.length) } : (BUILTIN.find(([l]) => l === row)?.[1] ?? BUILTIN[0][1]);
  sortColumnsByLabel(ds.id, some ? targets : [], key, p.dir === DIRS[1] ? -1 : 1, row);
}
