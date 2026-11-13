// The eager seams for two uPlot plugin families that only some plots need,
// loaded ON DEMAND so a plain plot never pays for them in the eager bundle
// (MAIN_PLAN #29):
//   - `lib/axisExtras.ts` -- the Axis dialog's canvas extras (figures-audit
//     #6): needed only once some axis carries an extra;
//   - `lib/uplotGadgets.ts` -- the quick-fit / cursors ROI gadget frame
//     (#33/#34): needed only while the "qfit" tool is active. Moved behind
//     this seam to fund #6's eager bytes; the tool's first activation in a
//     session waits for one chunk, after which it is instant.
// `uplotOpts.buildOpts` reads each module through these getters and simply
// skips it while still null; the main plot viewport loads whatever its
// current args need (`components/Stage/useLazyPlotParts.ts`) and rebuilds
// once it resolves.

import { hasAxisExtras, type AxisFormat } from "./axisFormat";

type ExtrasModule = typeof import("./axisExtras");
type GadgetsModule = typeof import("./uplotGadgets");

let extras: ExtrasModule | null = null;
let gadgets: GadgetsModule | null = null;
let extrasLoading: Promise<void> | null = null;
let gadgetsLoading: Promise<void> | null = null;

/** The loaded axis-extras applier, or null before it has loaded. */
export function axisExtrasApplier(): ExtrasModule["applyAxisExtras"] | null {
  return extras?.applyAxisExtras ?? null;
}

/** The loaded gadget plugins, or null before they have loaded. */
export function gadgetPlugins(): GadgetsModule | null {
  return gadgets;
}

/** Load the axis-extras module once (idempotent; a failed load may retry). */
export function loadAxisExtras(): Promise<void> {
  extrasLoading ??= import("./axisExtras").then(
    (m) => {
      extras = m;
    },
    (e: unknown) => {
      extrasLoading = null;
      throw e;
    },
  );
  return extrasLoading;
}

/** Load the gadget plugins once (idempotent; a failed load may retry). */
export function loadGadgetPlugins(): Promise<void> {
  gadgetsLoading ??= import("./uplotGadgets").then(
    (m) => {
      gadgets = m;
    },
    (e: unknown) => {
      gadgetsLoading = null;
      throw e;
    },
  );
  return gadgetsLoading;
}

/** Whether any of these formats needs the extras drawn. */
export function needsAxisExtras(...fmts: readonly (AxisFormat | null | undefined)[]): boolean {
  return fmts.some(hasAxisExtras);
}
