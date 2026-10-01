// Binary column transport for /api/plot/series -- the client half of
// `routes/_columns.py`. A full-resolution plot payload at 1M x 7 rows was
// 146 MB of JSON text: ~1.2 s to encode server-side and ~0.9 s of
// `JSON.parse` on the main thread here, for 56 MB of float64 once decoded.
// This module asks the server (`Accept: application/x-quantized-columns`)
// for that float64 directly and decodes it into the SAME `PlotSeriesResponse`
// shape the JSON path produces, so `lib/plotdata.ts`'s `fromResponse` and
// everything after it (`maskExcludedPayload`, overlays, uPlot alignment) see
// no difference: every non-finite value becomes `null`, exactly where the
// JSON path's `jsonify` wrote `null`; `-0` survives as it does in JSON.
//
// Frame (see the backend module for the authoritative layout): "QZC1", a
// little-endian uint32 header length, the header JSON space-padded to an
// 8-byte boundary (a `Float64Array` view refuses an unaligned offset), then
// `n_columns` columns of `n_rows` little-endian float64. The header is the
// payload minus `data` plus those two counts.
//
// Loaded lazily by `./plot`'s `plotSeries` only for a dataset above its row
// threshold, so the decoder's bytes stay out of the eager bundle; every
// failure mode degrades to the JSON path (a JSON answer is taken as-is, an
// undecodable binary body is re-requested as JSON) -- the transport is an
// optimisation, never a new way to fail.

import { postJSONDatasetAware } from "./datasetCache";
import { ensureOk } from "./http";
import type { PlotRequest } from "./plot";
import type { PlotSeriesResponse } from "../types";

export const COLUMNS_MEDIA_TYPE = "application/x-quantized-columns";

const PATH = "/api/plot/series";
const MAGIC = [0x51, 0x5a, 0x43, 0x31]; // "QZC1"
const PREFIX = 8; // magic + uint32 header length

type ColumnsHeader = Omit<PlotSeriesResponse, "data"> & { n_columns: number; n_rows: number };

// Every shipping engine is little-endian, so the fast path is a bare
// Float64Array view; the DataView path keeps a big-endian host correct.
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function readColumn(buf: ArrayBuffer, byteOffset: number, n: number): (number | null)[] {
  const col: (number | null)[] = new Array<number | null>(n);
  if (LITTLE_ENDIAN) {
    const f = new Float64Array(buf, byteOffset, n);
    for (let i = 0; i < n; i++) {
      const v = f[i];
      col[i] = Number.isFinite(v) ? v : null;
    }
  } else {
    const dv = new DataView(buf, byteOffset, n * 8);
    for (let i = 0; i < n; i++) {
      const v = dv.getFloat64(i * 8, true);
      col[i] = Number.isFinite(v) ? v : null;
    }
  }
  return col;
}

/** Decode one column frame into the JSON path's `PlotSeriesResponse`. Throws
 *  on anything that is not a well-formed frame (the caller falls back). */
export function decodeColumns(buf: ArrayBuffer): PlotSeriesResponse {
  const bytes = new Uint8Array(buf);
  if (bytes.length < PREFIX || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error("not a column frame (bad magic)");
  }
  const headerLen = new DataView(buf).getUint32(4, true);
  const offset = PREFIX + headerLen;
  if (offset % 8 !== 0 || offset > bytes.length) {
    throw new Error("column frame header is misaligned or truncated");
  }
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREFIX, offset))) as ColumnsHeader;
  const { n_columns, n_rows, ...rest } = header;
  if (!Number.isInteger(n_columns) || !Number.isInteger(n_rows) || n_columns < 0 || n_rows < 0) {
    throw new Error("column frame header has invalid counts");
  }
  if (bytes.length !== offset + n_columns * n_rows * 8) {
    throw new Error(`column frame is ${bytes.length} bytes, expected ${offset + n_columns * n_rows * 8}`);
  }
  const data: (number | null)[][] = [];
  for (let c = 0; c < n_columns; c++) data.push(readColumn(buf, offset + c * n_rows * 8, n_rows));
  return { ...rest, data };
}

const post = (path: string, body: string, accept: string, signal?: AbortSignal): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body,
    signal,
  });

/** The raw fetch primitive `postJSONDatasetAware` drives (same contract as
 *  `http.ts`'s JSON one, so the handle cache, its 409 recovery and the
 *  cell-patch upload all work unchanged): POST with the column type in
 *  `Accept`, decode a binary answer, take a JSON answer as-is, and re-request
 *  as JSON when a binary body will not decode. */
async function fetchColumns<T>(path: string, body: unknown, signal?: AbortSignal): Promise<{ value: T; handle: string | null }> {
  const text = JSON.stringify(body);
  const res = await ensureOk(await post(path, text, `${COLUMNS_MEDIA_TYPE}, application/json`, signal));
  const handle = res.headers.get("X-Dataset-Handle");
  if (!(res.headers.get("Content-Type") ?? "").startsWith(COLUMNS_MEDIA_TYPE)) {
    return { value: (await res.json()) as T, handle };
  }
  try {
    return { value: decodeColumns(await res.arrayBuffer()) as T, handle };
  } catch (err) {
    if (signal?.aborted) throw err;
    const again = await ensureOk(await post(path, text, "application/json", signal));
    return { value: (await again.json()) as T, handle: again.headers.get("X-Dataset-Handle") };
  }
}

/** `plotSeries` over the binary column transport. Same request, same
 *  result shape, same dataset-handle caching. */
export function plotSeriesColumns(req: PlotRequest, signal?: AbortSignal): Promise<PlotSeriesResponse> {
  return postJSONDatasetAware<PlotSeriesResponse>(PATH, req, signal, fetchColumns);
}
