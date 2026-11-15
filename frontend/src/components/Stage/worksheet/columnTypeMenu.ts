// The "Modeling type" submenu of the worksheet column context menu: the
// roomy twin of the header's small corner select (ColumnTypeSelect.tsx), so
// the type is reachable without aiming at a ~50 px control.

import type { ModelingType } from "../../../lib/types";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

const CHOICES: [ModelingType | null, string][] = [
  [null, "Auto (inferred)"],
  ["continuous", "Continuous"],
  ["ordinal", "Ordinal"],
  ["nominal", "Nominal"],
];

/** One submenu for a real value column (`col >= 0`); `override` is the user's
 *  explicit type (undefined = auto). */
export function modelingTypeItems(
  col: number,
  override: ModelingType | undefined,
  set: (col: number, t: ModelingType | null) => void,
): ContextMenuItem[] {
  if (col < 0) return [];
  return [
    {
      label: "Modeling type",
      submenu: CHOICES.map(([t, label]) => ({ label, checked: (override ?? null) === t, run: () => set(col, t) })),
    },
  ];
}
