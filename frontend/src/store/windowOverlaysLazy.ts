// The eager handle on store/windowOverlays.ts (gap audit 5 lane C), which
// keeps a plot window's analysis overlays in its document. That module, the
// overlay section's validation and the data hash (lib/figureOverlays,
// lib/dataFingerprint) are a lazy chunk, fetched once at startup: the focus /
// commit paths in the eager store call it synchronously through `overlaysNow`,
// and simply skip folding and seeding until it has arrived (the first moments
// after launch, before any overlay exists) -- a skipped fold leaves a document
// exactly as it was, so nothing is ever lost by it. Hydration awaits it.

type WindowOverlays = typeof import("./windowOverlays");

let mod: WindowOverlays | null = null;
let inflight: Promise<WindowOverlays> | undefined;

/** The module, fetched once. */
export const loadWindowOverlays = (): Promise<WindowOverlays> =>
  (inflight ??= import("./windowOverlays").then((m) => (mod = m)));

/** The module when it has loaded, else null (callers then skip overlays). */
export const overlaysNow = (): WindowOverlays | null => mod;

loadWindowOverlays().catch(() => (inflight = undefined)); // retried by the next load
