// The worksheet's user-parameter dialogs (lib/userParams.ts): legend labels
// from a template, and curve order by a numeric parameter. Each asks through
// the shared ParamDialog and applies through store/userParamActions.ts.

import type { Dataset } from "../../../lib/types";
import { userParamRows } from "../../../lib/userParams";
import { applyParamLegendTemplate, noUserParamsNotice, orderCurvesByParam } from "../../../store/userParamActions";
import { askParams } from "../../overlays/ParamDialog";

/** Legend labels for `cols` from a template such as `{Temperature} K`. */
export async function legendFromParamsDialog(ds: Dataset, cols: readonly number[]): Promise<void> {
  const names = userParamRows(ds.data).map((r) => r.name);
  const p = await askParams(
    cols.length > 1 ? `Legend labels — ${cols.length} columns` : "Legend label",
    [
      {
        key: "template",
        label: "Template",
        type: "text",
        default: names[0] ? `{${names[0]}}` : "{label}",
        hint: `{Name} = a user parameter${names.length ? ` (${names.join(", ")})` : ""}; also {label}, {unit}, {comment}`,
      },
    ],
    { confirmLabel: "Apply", message: "Writes ordinary legend labels for the selected columns (undoable). A column missing a value keeps its label." },
  );
  if (p) applyParamLegendTemplate(ds.id, cols, String(p.template));
}

/** Order the plotted curves by a numeric parameter (e.g. Temperature). */
export async function orderByParamDialog(ds: Dataset, cols: readonly number[]): Promise<void> {
  const names = userParamRows(ds.data).map((r) => r.name);
  if (names.length === 0) {
    noUserParamsNotice();
    return;
  }
  const dirs = ["Ascending", "Descending"];
  const p = await askParams(
    "Order curves by parameter",
    [
      { key: "name", label: "Parameter", type: "select", options: names, default: names[0] },
      { key: "dir", label: "Order", type: "select", options: dirs, default: dirs[0] },
    ],
    {
      confirmLabel: "Order",
      message: cols.length > 1 ? "Reorders the selected plotted curves; blank or non-numeric values go last." : "Reorders the plotted curves; blank or non-numeric values go last.",
    },
  );
  if (p) orderCurvesByParam(ds.id, String(p.name), p.dir === dirs[1] ? -1 : 1, cols.length > 1 ? cols : []);
}
