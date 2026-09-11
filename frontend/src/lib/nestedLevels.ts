// The ONE answer to "which levels, nested inside which, in what display order?"
// for a two-factor categorical grouping (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 /
// JMP_GAP J8's lot/wafer reading).
//
// WHY ITS OWN MODULE. `lib/variability.ts`'s `buildNestedLevels` already worked
// this out once, and its comment history is the argument for extracting it: the
// factor-B ordering there was a SIXTH private copy of "distinct finite values,
// ascending" (Group O-1), and when J1 made level order user-settable it became
// the defect its own comment had predicted — factor A honoured the user's order
// because it came from `categoryLevels`, factor B did not, so one chart showed
// two orders (Group O-2 review, MEDIUM 5). Adding a nested box plot would have
// been the third place to re-derive the same decision. It is derived here, once.
//
// WHAT "NESTED" MEANS HERE, stated because it is easy to get wrong: the
// structure is which B values CO-OCCUR with which A value. It is NOT a claim
// that a B code means the same real-world thing across A levels — JMP's reading
// is that "wafer 1 of lot 1" and "wafer 1 of lot 2" are unrelated, and today's
// numeric coding cannot distinguish them by label alone. Only the grouping
// structure is meaningful, which is why this returns per-A-level B lists rather
// than one shared B axis.
//
// ORDER, and why factor B cannot just call `categoryLevels`: A's levels are the
// whole column's, so `categoryLevels` serves. B's are the levels co-occurring
// with ONE A level — a filtered subset no whole-column read produces — so it
// composes the same two primitives `categoryLevels` is built from
// (`levelsOf` + `orderLevels` over `levelOrderFor`) instead of growing a second
// private answer. Both therefore honour a user's level order identically.

import { resolveCategoryLabels } from "./barlayout";
import { categoryLevels, columnOf, levelOrderFor, levelsOf, orderLevels } from "./categorical";
import type { DataStruct } from "./types";

/** One factor-A level and the factor-B levels nested under it, both in display
 *  order, with their resolved text labels alongside. Codes and labels are
 *  positionally aligned. */
export interface NestedLevels {
  aCode: number;
  aLabel: string;
  bCodes: number[];
  bLabels: string[];
}

/** Factor A's levels in display order, each carrying the factor-B levels that
 *  co-occur with it, also in display order.
 *
 *  Returns STRUCTURE only — no values and no row indices — because its two
 *  consumers need different payloads from the same decision: the variability
 *  chart wants response values per cell, the nested box plot wants values AND
 *  original row indices (its jitter overlay hashes the row). Bucketing is
 *  cheap and consumer-specific; the ORDER is the part that must not diverge.
 *
 *  Empty A levels are NOT dropped here — a caller that requires non-empty cells
 *  (`calc.stats_varcomp` does) filters after bucketing, since only bucketing
 *  knows whether a cell has finite payload. */
export function nestedLevels(
  data: DataStruct,
  factorACol: number,
  factorBCol: number,
): NestedLevels[] {
  const av = columnOf(data, factorACol);
  const bv = columnOf(data, factorBCol);

  const aCodes = categoryLevels(data, factorACol);
  const aLabels = resolveCategoryLabels(data, factorACol, aCodes);
  const bOrder = levelOrderFor(data, factorBCol);

  return aCodes.map((aCode, ai) => {
    // The B values appearing in rows where A is this level; `NaN` elsewhere,
    // which `levelsOf` drops. Reuses the shared `levelsOf` rather than
    // open-coding a distinct-value walk.
    //
    // NO ROW BOUND, deliberately. The version extracted from
    // `buildNestedLevels` carried an `r < n` guard against the shorter of the
    // two columns; a sabotage that removed it stayed green, and `levelsOf` is
    // why — it filters `null`/`undefined`/non-finite, which is exactly what a
    // short `bv` yields past its end. Keeping a bound that prevents nothing
    // would read as load-bearing to the next person.
    const bCodes = orderLevels(
      levelsOf(av.map((a, r) => (a === aCode ? bv[r] : Number.NaN))),
      bOrder,
    );
    return {
      aCode,
      aLabel: aLabels[ai],
      bCodes,
      bLabels: resolveCategoryLabels(data, factorBCol, bCodes),
    };
  });
}
