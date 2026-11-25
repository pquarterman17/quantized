// The lazy-only half of composition.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the spatial composition builder. Only lazy modules and tests call it.
// The code moved here verbatim and composition.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { Composition } from "./composition";
import type { SpatialPanel } from "./multipanel";

/** Build a spatial composition, or `null` when there is nothing to arrange.
 *  (Invariant 1: empty never becomes a kind-tagged empty object.) */
export function spatialComposition(panels: SpatialPanel[]): Composition | null {
  return panels.length > 0 ? { kind: "spatial", panels } : null;
}
