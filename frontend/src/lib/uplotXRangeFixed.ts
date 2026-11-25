// The lazy-only half of uplotXRange.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the fixed-range test. Only lazy modules call it.
// The code moved here verbatim and uplotXRange.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type uPlot from "uplot";
import { fixedRanges } from "./uplotXRange";

/** Is this x range a fixed limit (`fixedXRange`), not an autoscale scan? */
export function isFixedXRange(range: unknown): range is uPlot.Range.Function {
  return typeof range === "function" && fixedRanges.has(range as uPlot.Range.Function);
}
