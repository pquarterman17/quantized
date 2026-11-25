// The lazy-only half of windowSnap.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the resize-only snap. Only lazy modules and tests call it.
// The code moved here verbatim and windowSnap.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { WindowGeometry } from "./plotview";
import { SNAP_THRESHOLD, snapResizeGeometry } from "./windowSnap";

/** Compatibility wrapper retained for the original bottom-right geometry
 * regression suite; all production gestures use snapResizeGeometry. */
export function snapResizeSize(
  proposed: WindowGeometry,
  bounds: { width: number; height: number } | undefined,
  siblings: readonly WindowGeometry[],
  threshold: number = SNAP_THRESHOLD,
): { w: number; h: number } {
  const { w, h } = snapResizeGeometry(proposed, { e: true, s: true }, bounds, siblings, threshold);
  return { w, h };
}
