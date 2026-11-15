// The "Modeling type" submenu of the worksheet column context menu: the
// roomy twin of the header's small corner select (ColumnTypeSelect.tsx), so
// the type is reachable without aiming at a ~50 px control. Like Hide/Freeze
// beside it, it acts on the whole header selection when the clicked column is
// part of it (`targets`), else on just that column.

import type { ModelingType } from "../../../lib/types";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

const CHOICES: [ModelingType | null, string][] = [
  [null, "Auto (inferred)"],
  ["continuous", "Continuous"],
  ["ordinal", "Ordinal"],
  ["nominal", "Nominal"],
];

/** One submenu for real value columns (`targets` below 0 are ignored); a
 *  choice is checked only when every target already has it. `overrides` is the
 *  user's explicit types (absent = auto). */
export function modelingTypeItems(
  targets: readonly number[],
  overrides: Record<number, ModelingType> | undefined,
  set: (cols: readonly number[], t: ModelingType | null) => void,
): ContextMenuItem[] {
  const cols = targets.filter((c) => c >= 0);
  if (cols.length === 0) return [];
  return [
    {
      label: cols.length > 1 ? `Modeling type (${cols.length} columns)` : "Modeling type",
      submenu: CHOICES.map(([t, label]) => ({
        label,
        checked: cols.every((c) => (overrides?.[c] ?? null) === t),
        run: () => set(cols, t),
      })),
    },
  ];
}
