// Variability chart (JMP_GAP_PLAN J8 UI) — builds calc.stats_varcomp's
// two-level nested-groups wire shape (`groups[i][j]` = response values for
// factor-A level i, factor-B level j nested in A) from two picked
// categorical columns + one continuous response column. Numeric-coded
// levels only: JMP_GAP_PLAN's dependency note says the workbench halves
// "want J1 [string categorical columns] for text factors but degrade to
// today's numeric-coded levels" — J1 hasn't landed, so this reads raw
// column values the same way lib/barlayout (bar-chart categories) and
// fityx/runLeg.ts (oneway ANOVA grouping) already do.

import { columnOf } from "./categorical";
import { nestedLevels } from "./nestedLevels";
import type { DataStruct } from "./types";

export interface VariabilityCell {
  /** 0-based position within its A-level's cells — matches the backend's
   *  b_index (calc.stats_varcomp.variability_summary). */
  bIndex: number;
  bLabel: string;
  values: number[];
}

export interface VariabilityFactorLevel {
  /** 0-based position in the returned array — matches the backend's a_index. */
  aIndex: number;
  aLabel: string;
  cells: VariabilityCell[];
}

/** Two-level nested grouping: factor-A levels (sorted, distinct finite
 *  values of `factorACol`), each holding the factor-B levels that actually
 *  co-occur with it (sorted, distinct finite values of `factorBCol` among
 *  that A-level's rows). "Nested" here is structural — which B values
 *  appear together with which A value — not a claim that a given B raw
 *  value means the same real-world thing across different A levels (JMP's
 *  lot/wafer reading: "wafer 1 of lot 1" and "wafer 1 of lot 2" are
 *  unrelated even though today's numeric coding can't distinguish them by
 *  label alone; only the grouping structure matters to the ANOVA/variance
 *  math, which is exactly why calc.stats_varcomp's contract is a nested
 *  list, not label-keyed).
 *
 *  Cells with zero finite response values are dropped (calc.stats_varcomp
 *  requires every cell non-empty); an A level left with zero cells is
 *  dropped too — so the result is already exactly the shape
 *  `toWireGroups`/the backend need, with `aIndex`/`bIndex` consecutive from
 *  0 on both axes. */
export function buildNestedLevels(
  data: DataStruct,
  responseCol: number,
  factorACol: number,
  factorBCol: number,
): VariabilityFactorLevel[] {
  const av = columnOf(data, factorACol);
  const bv = columnOf(data, factorBCol);
  const rv = columnOf(data, responseCol);
  const n = Math.min(av.length, bv.length, rv.length);

  // The A/B level structure and its display order now come from
  // `lib/nestedLevels.ts` — extracted verbatim from here so a nested BOX plot
  // (P2.6) consumes the same decision instead of re-deriving it a third time.
  // The Group O-1/O-2 review comments this block used to carry are the argument
  // for that, and they moved with the code. What stays here is the part that is
  // genuinely this chart's own: bucketing response values, and dropping empty
  // cells and empty A levels because `calc.stats_varcomp` requires every cell
  // non-empty — which is why `aIndex`/`bIndex` count the KEPT entries rather
  // than the structural ones.
  const result: VariabilityFactorLevel[] = [];
  for (const lvl of nestedLevels(data, factorACol, factorBCol)) {
    const cells: VariabilityCell[] = [];
    for (let bi = 0; bi < lvl.bCodes.length; bi++) {
      const b = lvl.bCodes[bi];
      const values: number[] = [];
      for (let r = 0; r < n; r++) {
        if (av[r] === lvl.aCode && bv[r] === b && Number.isFinite(rv[r])) values.push(rv[r]);
      }
      if (values.length > 0) cells.push({ bIndex: cells.length, bLabel: lvl.bLabels[bi], values });
    }
    if (cells.length > 0) result.push({ aIndex: result.length, aLabel: lvl.aLabel, cells });
  }
  return result;
}

/** The `/api/stats/{nested-anova,variance-components,variability-summary}`
 *  wire shape: `groups[i][j]` = cell (i,j)'s response values. */
export function toWireGroups(levels: VariabilityFactorLevel[]): number[][][] {
  return levels.map((lvl) => lvl.cells.map((c) => c.values));
}
