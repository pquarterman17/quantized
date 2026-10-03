// The X well's extra option: the dataset's own x/time column, offered by its
// name and unit under the spec model's reserved channel (`OWN_X_CHANNEL`).
// Every renderer maps that channel to the same null xKey an empty X well
// means (lib/plotspecGroupCol's `specXKey`), so picking it and leaving the
// well empty plot identically; the pick just makes the choice explicit.

import { OWN_X_CHANNEL } from "../../../lib/plotspecGroupCol";
import type { DataStruct, Dataset } from "../../../lib/types";
import type { WellOption } from "./ZoneWell";
import { withUnit } from "../../../lib/unitDisplay";

/** The dataset's own X, as the well names it: "Field (Oe)", or "Field". */
export function ownXLabel(data: DataStruct): string {
  const name = String(data.metadata?.["x_column_name"] ?? "") || "x";
  const unit = String(data.metadata?.["x_column_unit"] ?? "");
  return withUnit(name, unit);
}

/** The X well's options: the dataset's own X first, then every value column. */
export function xWellOptions(ds: Dataset | null, options: WellOption[]): WellOption[] {
  return ds ? [{ index: OWN_X_CHANNEL, label: ownXLabel(ds.data) }, ...options] : [];
}
