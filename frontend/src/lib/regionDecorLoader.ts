// The eager half of the region-shade / off-scale-marker drawing
// (lib/uplotRegionShades.ts, a LAZY chunk for the eager-bundle budget -- its
// header): the loader and the signals a plot redraws on. Split out of
// lib/uplotOverlays.ts (its module-size pin), whose draw hooks read the
// module through `regionDecor()` and draw nothing while it is absent.
//
// The import starts when this module loads (app startup). A plot drawn
// before it lands misses its shades / off-scale markers, so the viewport
// waits for `regionDecorSettled` and rebuilds (Stage/useLazyPlotParts.ts).

type DecorModule = typeof import("./uplotRegionShades");

let decor: DecorModule | null = null;
let decorSettled = false;
/** Settles once the shade chunk has loaded -- or failed to (offline: no
 *  shades drawn, never a crash). */
export const regionDecorSettled: Promise<void> = import("./uplotRegionShades")
  .then(
    (m) => {
      decor = m;
    },
    () => {},
  )
  .then(() => {
    decorSettled = true;
  });
export const regionDecorReady = (): boolean => decorSettled;

/** The loaded shade / off-scale drawing, or null before it lands. */
export const regionDecor = (): DecorModule | null => decor;
