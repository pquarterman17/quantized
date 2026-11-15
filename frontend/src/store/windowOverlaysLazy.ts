// The eager handle on store/windowOverlays.ts (gap audit 5 lane C), which
// keeps a plot window's fit curve in its document. That module, the section's
// validation and the data hash are a lazy chunk, fetched at startup: the eager
// focus / commit paths call it synchronously through `overlaysNow` and simply
// skip it until it has arrived. A skipped handoff leaves the module without a
// record of that focus, and its fold then never removes a section -- so nothing
// is lost by it. A failed fetch is retried on the next `overlaysNow` miss.

type WindowOverlays = typeof import("./windowOverlays");

let mod: WindowOverlays | null = null;
let inflight: Promise<WindowOverlays> | undefined;

/** The module, fetched once (again after a failure). */
export function loadWindowOverlays(): Promise<WindowOverlays> {
  inflight ??= import("./windowOverlays").then((m) => (mod = m), (e: unknown) => {
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

overlaysNow();
