// What the formulas contribute to a named range's delete (ROW_RANGE_CONTRACT 5.3, slice R4b): the dependants dialog
// lists the formula columns that read the range with `rng("Name")`, and a confirmed delete CUTS their links (`id:
// null`) and re-evaluates them, so each shows "named range ... was removed" instead of its last values and none ever
// re-binds to a later range of the same name. Registered with `registerNamedRangeDependants` (store/namedRanges.ts),
// so the delete lists and cuts them inside its own undo step.

import { cutRangeRefs, rangeReaderLabels } from "../lib/rangeRefs";
import { recomputeFormulaData } from "./computedColumns";
import type { NamedRangeDependants } from "./namedRanges";

export const formulaDependants: NamedRangeDependants = {
  find: (state, rangeId) => rangeReaderLabels(state.datasets, rangeId).map((label) => ({ kind: "formula column", label })),
  cut: (state, rangeId) => {
    const cut = cutRangeRefs(state.datasets, rangeId);
    if (!cut.changed.length) return {};
    const changed = new Set(cut.changed);
    return { datasets: cut.datasets.map((d) => (changed.has(d.id) ? recomputeFormulaData(d) : d)) };
  },
};
