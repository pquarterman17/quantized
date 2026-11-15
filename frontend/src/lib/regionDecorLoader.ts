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

/** Load the chunk with `load`, two attempts. It also draws the ERROR BARS
 *  (`lib/uplotErrorDraw.ts`), which are data, not decoration, so a failure is
 *  never silent (review M2): the status line says what is missing and how to
 *  get it back (a reload fetches the current chunk after an upgrade). Resolves
 *  to the module, or null when both attempts failed. */
export async function settleDecor(load: () => Promise<DecorModule>): Promise<DecorModule | null> {
  for (let i = 0; i < 2; i++) {
    try {
      return await load();
    } catch {
      /* retried once */
    }
  }
  // Imported only on failure, as marksLoader does: a static import would pull the store into every
  // module that reaches this one.
  const { useApp } = await import("../store/useApp");
  useApp.getState().setStatus("Error bars, shades and colour-mapped points could not load; reload.");
  return null;
}

/** Settles once the shade / error-bar chunk has loaded -- or failed to twice
 *  (offline: nothing of it drawn, a status message, never a crash). */
export const regionDecorSettled: Promise<void> = settleDecor(() => import("./uplotRegionShades")).then((m) => {
  decor = m;
  decorSettled = true;
});
export const regionDecorReady = (): boolean => decorSettled;

/** The loaded shade / off-scale drawing, or null before it lands. */
export const regionDecor = (): DecorModule | null => decor;
