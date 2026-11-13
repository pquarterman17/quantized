// The eager half of the canvas axis-title / rich-title drawing
// (lib/uplotRichLabels.ts, a LAZY chunk for the eager-bundle budget): the
// loader and the signals a plot rebuilds on -- the lib/regionDecorLoader.ts
// shape.
//
// The import starts when this module loads (app startup), so it is usually
// in place by the first plot. A plot built before it lands keeps uPlot's own
// plain axis titles (a rich title shows as typed, a moved one at its default
// spot, none is draggable yet), and the viewport waits for
// `richLabelsSettled` and rebuilds (Stage/useLazyPlotParts.ts) -- the same
// literal-first fallback the Origin-escape chunk takes.

export type { AxisLabelEditOpts } from "./uplotRichLabels";

type RichLabelsModule = typeof import("./uplotRichLabels");

let mod: RichLabelsModule | null = null;
let settled = false;
/** Settles once the chunk has loaded -- or failed to (offline: titles stay
 *  uPlot's plain ones, never a crash). */
export const richLabelsSettled: Promise<void> = import("./uplotRichLabels")
  .then(
    (m) => {
      mod = m;
    },
    () => {},
  )
  .then(() => {
    settled = true;
  });
export const richLabelsReady = (): boolean => settled;

/** The loaded title drawing, or null before it lands. */
export const richLabels = (): RichLabelsModule | null => mod;
