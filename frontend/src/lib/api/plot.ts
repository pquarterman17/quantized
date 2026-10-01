// Plot-series + map-grid endpoint wrappers — the `/api/plot/*` half of the
// typed backend client. Extracted from `lib/api.ts` (P3.4 zoom-refetch
// residual): that file is pinned shrink-only (JMP_GAP #14,
// `architecture.test.ts`), and the window/signal params this file's
// `plotSeries` needed would have pushed it back over its pin. Same template
// as `api/stats.ts` — new `/api/plot/*` wrappers go HERE, not in api.ts.
//
// Re-exported by `lib/api.ts`, so every consumer keeps importing from
// `./lib/api` unchanged.

import { postJSON } from "./http";
import type { DataStruct, MapResponse, PlotSeriesResponse } from "../types";

export interface PlotRequest {
  dataset: DataStruct;
  x_key?: number | string | null;
  y_keys?: (number | string)[] | null;
  y2_keys?: (number | string)[] | null;
  x_log?: boolean;
  y_log?: boolean;
  decimate_width?: number | null; // P3.4 decimation hint (target px width) -- see lib/plotdata.ts's fetchPlot
  // P3.4 zoom-refetch residual: the committed X view window of a follow-up
  // request re-fetching an already-decimated payload at full local detail
  // (routes/plot.py windows BEFORE decimating). Must be provided together
  // (both or neither) -- see fetchPlot's own doc.
  x_min?: number | null;
  x_max?: number | null;
}

/** Datasets with more rows than this ask for the binary column transport
 *  (`./plotColumns`) instead of JSON. Gated on the dataset's rows, not the
 *  response's: the response never has more rows than the dataset, a
 *  decimated one is cheap either way, and a windowed full-detail re-fetch
 *  of a large dataset is exactly the case the transport exists for. Below
 *  the threshold JSON is small enough that the decoder chunk's load and
 *  the typed-array copy would not pay for themselves. */
export const COLUMNS_ROW_THRESHOLD = 50_000;

/** Build uPlot-ready series from a DataStruct + selection. `signal` lets a
 *  caller abort mid-request (P3.4 zoom-refetch: a newer committed view
 *  supersedes whatever windowed re-fetch was still in flight for a stale
 *  one) -- see importFile's doc for the same pattern.
 *
 *  Above `COLUMNS_ROW_THRESHOLD` rows the request goes through the lazily
 *  loaded binary column transport, which decodes into this same response
 *  shape; if that chunk fails to load, or the server answers in JSON, or a
 *  binary body will not decode, the result is the JSON path's (see
 *  `./plotColumns`). Every caller sees one contract either way. */
export async function plotSeries(req: PlotRequest, signal?: AbortSignal): Promise<PlotSeriesResponse> {
  if (req.dataset.time.length > COLUMNS_ROW_THRESHOLD) {
    let columns: Pick<typeof import("./plotColumns"), "plotSeriesColumns"> | undefined;
    try {
      columns = await import("./plotColumns");
    } catch {
      columns = undefined; // chunk failed to load -- the JSON path below is always right
    }
    if (columns) return columns.plotSeriesColumns(req, signal);
  }
  return postJSON<PlotSeriesResponse>("/api/plot/series", req, signal);
}

export interface MapRequest {
  dataset: DataStruct;
  x_key: number | string;
  y_key: number | string;
  z_key: number | string;
  method?: string;
  nx?: number;
  ny?: number;
}

/** Regrid 3 scattered channels (x, y, z) of a DataStruct into a heatmap grid.
 *  `signal` (RSM_CUTS_PLAN item 16) lets a caller abort mid-request -- the
 *  2θ/ω ⇄ Q toggle re-fetches on every keys/method/res change, and without
 *  this the superseded request just kept computing server-side after its
 *  result was discarded. Same pattern as `plotSeries`'s `signal`.
 *
 *  This is the single largest repeat-payload offender (item 18 measured
 *  45.5 MB on the real corpus's largest map) -- `postJSON` transparently
 *  caches `req.dataset` server-side and re-sends only a short handle on
 *  every call after the first for the SAME dataset object, with no change
 *  needed here (see lib/api/datasetCache.ts). */
export function mapSeries(req: MapRequest, signal?: AbortSignal): Promise<MapResponse> {
  return postJSON<MapResponse>("/api/plot/map", req, signal);
}
