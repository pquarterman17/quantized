// Variability chart (JMP_GAP_PLAN J8 UI) — builds calc.stats_varcomp's
// two-level nested-groups wire shape (`groups[i][j]` = response values for
// factor-A level i, factor-B level j nested in A) from two picked
// categorical columns + one continuous response column. Numeric-coded
// levels only: JMP_GAP_PLAN's dependency note says the workbench halves
// "want J1 [string categorical columns] for text factors but degrade to
// today's numeric-coded levels" — J1 hasn't landed, so this reads raw
// column values the same way lib/barlayout (bar-chart categories) and
// fityx/runLeg.ts (oneway ANOVA grouping) already do.

import { categoryLevels, resolveCategoryLabels } from "./barlayout";
import { columnOf, levelsOf } from "./categorical";
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

  const aLevels = categoryLevels(data, factorACol);
  const aLabels = resolveCategoryLabels(data, factorACol, aLevels);

  const result: VariabilityFactorLevel[] = [];
  for (let ai = 0; ai < aLevels.length; ai++) {
    const a = aLevels[ai];
    // Group O-1 review: this was a SIXTH private copy of "distinct finite
    // values, ascending" — spelled as a loop plus `.add`, which is why the
    // chokepoint's first regex could not see it and why the commit that added
    // that guard claimed five copies. It is order-sensitive and user-visible:
    // `bLevels` becomes the sub-axis order on the chart and the `b_index`
    // ordering on the `calc.stats_varcomp` wire, so under J1 it would have kept
    // sorting factor B by raw code while factor A (which comes from
    // `categoryLevels`) honoured the user's order — one chart, two orders.
    // The row filter stays: these are the B values that CO-OCCUR with this A
    // level, which is what makes the grouping nested.
    const bLevels = levelsOf(av.map((av_r, r) => (av_r === a && r < n ? bv[r] : Number.NaN)));
    const bLabels = resolveCategoryLabels(data, factorBCol, bLevels);

    const cells: VariabilityCell[] = [];
    for (let bi = 0; bi < bLevels.length; bi++) {
      const b = bLevels[bi];
      const values: number[] = [];
      for (let r = 0; r < n; r++) {
        if (av[r] === a && bv[r] === b && Number.isFinite(rv[r])) values.push(rv[r]);
      }
      if (values.length > 0) cells.push({ bIndex: cells.length, bLabel: bLabels[bi], values });
    }
    if (cells.length > 0) result.push({ aIndex: result.length, aLabel: aLabels[ai], cells });
  }
  return result;
}

/** The `/api/stats/{nested-anova,variance-components,variability-summary}`
 *  wire shape: `groups[i][j]` = cell (i,j)'s response values. */
export function toWireGroups(levels: VariabilityFactorLevel[]): number[][][] {
  return levels.map((lvl) => lvl.cells.map((c) => c.values));
}
