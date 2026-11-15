// /api/export/map-figure wrapper — the 2-D map's server-rendered (matplotlib)
// publication export. Its own module (not lib/api/figures.ts) because its one
// consumer is the lazy MapStage chunk: co-locating it with the eager figure
// exports would drag it into the eager bundle for nothing.
//
// `signal` (P3.4): the caller's runCancellable signal; a cancelled download
// saves nothing (postDownload re-checks it right before writing).

import { postBlob, postDownload } from "./http";
import type { components } from "./schema";

/** Gap cells travel as `null` (the route reads them as NaN), exactly as
 *  /api/plot/map serves them. */
export type MapFigureSpec = components["schemas"]["MapFigureRequest"];

/** Render a gridded map to a PDF/SVG/PNG/TIFF figure and download it. */
export function exportMapFigure(body: MapFigureSpec, signal?: AbortSignal): Promise<void> {
  return postDownload(
    "/api/export/map-figure",
    body,
    `${body.filename ?? "map"}.${body.fmt ?? "pdf"}`,
    signal,
  );
}

/** The same route, returned as image bytes instead of a download: the Map
 *  stage's static 3-D preview. The caller sends the export's own body with
 *  only `fmt` (and `filename`) changed, so the preview is the figure. */
export function renderMapFigure(body: MapFigureSpec, signal?: AbortSignal): Promise<Blob> {
  return postBlob("/api/export/map-figure", body, signal);
}
