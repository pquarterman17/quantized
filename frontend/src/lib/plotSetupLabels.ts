// Names for the plot-setup grid's pinned row.

import type { DataStruct } from "./types";
import { withUnit } from "./unitDisplay";

/** The dataset's own X as the grid names it: "Field (Oe)", or "x". */
export function ownXLabelOf(data: DataStruct): string {
  const name = String(data.metadata?.["x_column_name"] ?? "") || "x";
  return withUnit(name, String(data.metadata?.["x_column_unit"] ?? ""));
}
