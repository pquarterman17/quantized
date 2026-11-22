// The eager half of the text-annotation plugin (lib/uplotAnnotations.ts, a startup
// chunk for the eager budget -- bundle diet slice 31): the loader and the
// signals a plot rebuilds on. `uplotOpts.buildOpts` reads the module through
// `loadedAnnotations()` and wires no annotation plugin while it is absent.
//
// The import starts when this module loads (app startup, the regionDecorLoader
// shape), so by the time a plot has annotations
// the chunk is normally already there. A plot built before it lands
// rebuilds once `annotationsSettled` resolves (Stage/useLazyPlotParts.ts).

type AnnotationsModule = typeof import("./uplotAnnotations");

let mod: AnnotationsModule | null = null;
let settled = false;

/** Load the chunk with `load`, two attempts. Annotations are drawn DATA, so a
 *  failure is never silent: the status line says what is missing and how to
 *  get it back. Resolves to the module, or null when both attempts failed. */
export async function settleAnnotations(load: () => Promise<AnnotationsModule>): Promise<AnnotationsModule | null> {
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
  useApp.getState().setStatus("Text annotations could not load; reload.", "danger");
  return null;
}

/** Settles once the annotations chunk has loaded -- or failed to twice. */
export const annotationsSettled: Promise<void> = settleAnnotations(() => import("./uplotAnnotations")).then((m) => {
  mod = m;
  settled = true;
});
export const annotationsReady = (): boolean => settled;

/** The loaded annotation plugin module, or null before it lands. */
export const loadedAnnotations = (): AnnotationsModule | null => mod;
