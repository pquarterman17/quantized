// The lazy-only half of plotGroupSplit.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the split-level reader. Only lazy modules and tests call it.
// The code moved here verbatim and plotGroupSplit.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { categoryLevels } from "./categorical";
import type { DataStruct } from "./types";

/** The group-split levels for `groupCol` of `data`, in order — the ONE place
 *  the group well's level derivation lives, shared by `lib/plotspec.ts`'s
 *  `buildXY` (which builds a grouped payload from a DataStruct) and available
 *  to any future group-split caller that holds one.
 *
 *  Group O-1 extracted this out of `buildXY`, where it was an inline copy of
 *  `categoryLevels`. The extraction is NOT a bare swap, and the difference is
 *  the reason this function exists rather than a direct `categoryLevels` call:
 *  the inline version read `row[groupCol]`, so `groupCol === -1` produced
 *  `undefined` for every row and therefore NO levels and NO series, while
 *  `categoryLevels` reads the x/time column for -1 and would group BY it —
 *  potentially one series per row. Nothing structurally prevents -1 reaching
 *  the group zone (a `ChannelRef`'s `channel` is a plain number, and a
 *  hand-edited recipe parses through `normRef`), and deciding what a
 *  time-grouped plot SHOULD do is a design question, not a refactor's call. So
 *  the old answer is preserved here, named, with the question written down. */
export function groupSplitLevels(data: DataStruct, groupCol: number): number[] {
  return groupCol < 0 ? [] : categoryLevels(data, groupCol);
}
