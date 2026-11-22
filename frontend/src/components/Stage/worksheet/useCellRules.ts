// The grid's conditional-format lookup (lib/worksheetRules.ts), rebuilt only
// when the rules or the data change. Kept out of the pane and the grid, which
// sit at the component ceiling.

import { useMemo } from "react";

import { compileCellRules, type CellTint } from "../../../lib/worksheetRules";
import type { Dataset } from "../../../lib/types";

export function useCellRules(ds: Dataset): CellTint | undefined {
  return useMemo(() => compileCellRules(ds.cellRules, ds.data.values), [ds.cellRules, ds.data.values]);
}
