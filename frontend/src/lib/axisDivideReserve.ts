// The lazy-only half of lib/axisDivideLabel.ts (bundle diet, plans/
// BUNDLE_HEADROOM.md slice 34): the plot-options pass that reserves the band
// for a divide-by factor. Only lib/axisExtras.ts (loaded on demand) applies
// it, so the code moved here verbatim and lib/axisDivideLabel.ts re-exports it
// with `export *` - importers and tests are unchanged, and Rollup bundles this
// file with the lazy chunks that use it. architecture.test.ts ("re-exported
// lazy half") keeps eager modules off it.

import type uPlot from "uplot";

import { divideTopPadding } from "./axisDivideLabel";

/** uPlot's `opts` plugin hook body: widen the top padding for each vertical
 *  axis that shows a factor (`axes` index-aligned with the opts' axes). */
export function reserveDivideBand(opts: uPlot.Options, dividedAxes: readonly number[]): uPlot.Options {
  let need = 0;
  for (const idx of dividedAxes) {
    const axis = opts.axes?.[idx];
    // uPlot's Side enum, read as the plain number it is (AxisSide above).
    const side: number = axis?.side ?? (idx === 0 ? 2 : 3);
    if (side === 1 || side === 3) need = Math.max(need, divideTopPadding(typeof axis?.font === "string" ? axis.font : undefined));
  }
  if (!need) return opts;
  const pad = opts.padding ?? [null, null, null, null];
  const top = typeof pad[0] === "number" ? pad[0] : 0;
  return { ...opts, padding: [Math.max(top, need), pad[1], pad[2], pad[3]] };
}
