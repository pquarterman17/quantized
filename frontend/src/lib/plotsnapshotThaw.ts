// The lazy-only half of plotsnapshot.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the frozen-snapshot list thaw. Only lazy modules call them.
// The code moved here verbatim and plotsnapshot.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { mapNullish } from "./plotsnapshot";

/** Frozen null-normalized lists back to their `undefined`-holed render shape. */
export const thawList = <T>(list: (T | null)[] | null): (T | undefined)[] | undefined =>
  mapNullish(list, undefined);

/** Frozen entries back to the `Map` shape `PlotViewport` expects. */
export const thawEntries = <T>(entries: readonly (readonly [number, T])[]) => new Map(entries);
