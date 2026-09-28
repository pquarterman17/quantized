// The plot-mark allow-list, split out of `lib/plotspec.ts` (bundle diet slice
// 11, `plans/BUNDLE_HEADROOM.md`). `lib/figureDocument.ts` is on the first-
// paint path and needs only this list to validate a persisted mark; importing
// it from `lib/plotspec.ts` was the ONLY static edge from the entry chunk into
// the plot-spec grammar, and it carried `plotspec2`, `statstage`,
// `statschooser`, `tdist` and `nestedLevels` in with it (~18 kB eager). Every
// real consumer of the grammar (Graph Builder, the stat stages, the `.dwk`
// codec) is already lazy. `lib/plotspec.ts` re-exports `PLOT_MARKS`, so its
// own importers are unchanged.
//
// Keep this module free of VALUE imports: a value import from `./plotspec`
// here would fold the whole grammar back into the entry chunk
// (`architecture.test.ts`'s DRAGGED_OUT list catches that). The type import
// below is erased before bundling.

import type { PlotMark } from "./plotspec";

export type { PlotMark };

/** Every mark, in declaration order (also the validation allow-list). */
export const PLOT_MARKS: readonly PlotMark[] = ["scatter", "line", "step", "box", "violin", "bar"];
