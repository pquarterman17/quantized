// The eager handle on store/windowOverlays.ts (gap audit 5 lane C), which
// keeps a plot window's fit curve in its document. That module, the section's
// validation and the data hash are a lazy chunk, fetched at startup: the eager
// focus / commit / history paths call it synchronously through `overlaysNow`
// and simply skip it until it has arrived. A skipped handoff is noted, so the
// module's first fold of that focus neither captures (the slot may hold the
// previous window's fit) nor removes -- nothing is lost or spread by it. A
// failed fetch is retried on the next `overlaysNow` miss.

type WindowOverlays = typeof import("./windowOverlays");

let mod: WindowOverlays | null = null;
let inflight: Promise<WindowOverlays> | undefined;
let missed = false;

/** The module, fetched once (again after a failure). */
export function loadWindowOverlays(): Promise<WindowOverlays> {
  inflight ??= import("./windowOverlays").then((m) => {
    m.watch();
    return (mod = m);
  }, (e: unknown) => {
    inflight = undefined;
    throw e;
  });
  return inflight;
}

/** The module when it has loaded, else null (and a fetch is started). */
export function overlaysNow(): WindowOverlays | null {
  if (!mod) loadWindowOverlays().catch(() => undefined);
  return mod;
}

/** A focus handoff happened without the module (L5); read and cleared by it. */
export const noteMissedHandoff = (): undefined => void (missed = true);
export const missedHandoff = (): boolean => missed;
export const clearMissedHandoff = (): void => void (missed = false);

overlaysNow();
