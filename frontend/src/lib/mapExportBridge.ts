// The figure commands' way into a mounted map's own export (⤓ Export map).
//
// "Export figure…" and friends build an XY `FigureSpec` (lib/figureSpecStage.ts),
// which cannot describe a map. MapStage already has the right export
// (Stage/mapFigureExport.ts), but it needs the live canvas, payload and view,
// which live in React. Each mounted map registers its exporter here under its
// window id (or STAGE_MAP_KEY for the classic Map tab), and lib/figureTarget.ts
// looks up the one belonging to the window the user is working in.

/** Key of the classic stage's Map tab, which has no window id. */
export const STAGE_MAP_KEY = "stage";

const exporters = new Map<string, Array<() => void>>();

/** Register a map's exporter under `key`; the returned function unregisters it. The newest
 *  registration wins, and a stale unmount never removes another's. */
export function registerMapExporter(key: string, run: () => void): () => void {
  exporters.set(key, [...(exporters.get(key) ?? []), run]);
  return () => {
    const left = (exporters.get(key) ?? []).filter((fn) => fn !== run);
    if (left.length) exporters.set(key, left);
    else exporters.delete(key);
  };
}

/** The mounted map's exporter for `key`, or null (not mounted yet, or closed). */
export function mapExporterFor(key: string): (() => void) | null {
  return exporters.get(key)?.at(-1) ?? null;
}
