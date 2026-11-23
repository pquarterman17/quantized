// "Open in Statistical tests" for a Kaplan-Meier curve (OPEN_ITEMS row 12): the
// recorded test, column selection and grouping, read back strictly. FAIL CLOSED:
// null unless every field is present and of the right type (a partial record is
// never seeded). Lazy: imported by the opener and the stats-tests chunk only.

import type { ReopenSeed } from "./committedOutputReopen";
import type { TestParams, TestSelection } from "./statsTests";

export interface KaplanMeierSeed {
  selection: TestSelection;
  survivalGroups: boolean;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function kaplanMeierSeed(s: ReopenSeed | null | undefined): KaplanMeierSeed | null {
  if (!s || s["testId"] !== "kaplan-meier" || typeof s["survivalGroups"] !== "boolean") return null;
  const sel = s["selection"];
  if (!sel || typeof sel !== "object" || Array.isArray(sel)) return null;
  const { x, y, cols, byCol, byCol2, groupMode } = sel;
  if (!isNumber(x) || !isNumber(y) || !isNumber(byCol) || !isNumber(byCol2)) return null;
  if (!Array.isArray(cols) || !cols.every(isNumber)) return null;
  if (groupMode !== "columns" && groupMode !== "category") return null;
  return { selection: { x, y, cols: cols as number[], byCol, byCol2, groupMode }, survivalGroups: s["survivalGroups"] };
}

/** The columns the curve read (time, event, and the group column when grouped). */
export function kaplanMeierColumns(selection: TestSelection, params: Pick<TestParams, "survivalGroups">): number[] {
  return [selection.x, selection.y, ...(params.survivalGroups ? [selection.byCol] : [])];
}
