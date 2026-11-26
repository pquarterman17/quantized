// The lazy-only half of uplotErrorRange.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the error-band test. Only lazy modules and tests call it.
// The code moved here verbatim and uplotErrorRange.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { ErrorBarPaint } from "./uplotErrorRange";

/** Does this uPlot column draw its Y error as a band (gap audit 4 G8)? A box (plan item 24) wins. */
export const isErrorBand = (u: uPlot, col: number): boolean => {
  const e = (u.series[col] as uPlot.Series & { qzErr?: ErrorBarPaint })?.qzErr;
  return !!e?.band && !e.box;
};
