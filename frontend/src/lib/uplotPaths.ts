// Shared uPlot path builders, made once. They live in their own module (not
// uplotOpts.ts) because constructing them needs the uPlot *runtime* — the
// options builder keeps a type-only import so headless tests never pull in
// uPlot's matchMedia init. Stages pass these into buildOpts.
import uPlot from "uplot";

/** Step-after builder for the "Step" default trace. */
export const STEPPED_PATHS = uPlot.paths?.stepped?.({ align: 1 });

/** Plain linear builder — wrapped by buildOpts to draw non-monotonic-x data
 *  (hysteresis loops) over the full acquisition order. */
export const LINEAR_PATHS = uPlot.paths?.linear?.();

/** Built-in circle marker builder — same non-monotonic-x purpose, for points. */
export const POINTS_PATHS = uPlot.paths?.points?.();
