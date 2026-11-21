// The eager half of the drawn-shapes plugin (lib/uplotShapes.ts, a startup
// chunk for the eager budget -- bundle diet slice 31): the loader and the
// signals a plot rebuilds on. `uplotOpts.buildOpts` reads the module through
// `loadedShapes()` and wires no shapes plugin while it is absent.
//
// The import starts when this module loads (app startup, the regionDecorLoader
// shape), so by the time a plot has shapes -- or the user picks a draw-shape
// mode -- the chunk is normally already there. A plot built before it lands
// rebuilds once `shapesSettled` resolves (Stage/useLazyPlotParts.ts).

type ShapesModule = typeof import("./uplotShapes");

let shapes: ShapesModule | null = null;
let settled = false;

/** Load the chunk with `load`, two attempts. Shapes are drawn DATA, so a
 *  failure is never silent: the status line says what is missing and how to
 *  get it back. Resolves to the module, or null when both attempts failed. */
export async function settleShapes(load: () => Promise<ShapesModule>): Promise<ShapesModule | null> {
  for (let i = 0; i < 2; i++) {
    try {
      return await load();
    } catch {
      /* retried once */
    }
  }
  // Imported only on failure, as regionDecorLoader does: a static import would pull the store into every
  // module that reaches this one.
  const { useApp } = await import("../store/useApp");
  useApp.getState().setStatus("Drawn shapes could not load; reload.", "danger");
  return null;
}

/** Settles once the shapes chunk has loaded -- or failed to twice. */
export const shapesSettled: Promise<void> = settleShapes(() => import("./uplotShapes")).then((m) => {
  shapes = m;
  settled = true;
});
export const shapesReady = (): boolean => settled;

/** The loaded shapes plugin module, or null before it lands. */
export const loadedShapes = (): ShapesModule | null => shapes;
