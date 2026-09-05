// Client half of the server-side dataset-handle cache (RSM_CUTS_PLAN item
// 18). Every call to /api/plot/map, /api/plot/series, or /api/rsm/* normally
// re-sends the WHOLE DataStruct as JSON -- measured on the real corpus:
// m3learning_rsm.xrdml is 465,885 points / 45.5 MB, costing a main-thread
// JSON.stringify on the way out plus 1.9s server-side encode / 1.15s decode
// PER CALL, paid again on every channel change and every 2theta/omega <->
// Q toggle even though the dataset in memory never changed.
//
// The backend (routes/_datasetcache.py) now accepts EITHER the full
// `dataset` OR a `dataset_handle` string, and always echoes back whatever
// handle it resolved as the `X-Dataset-Handle` RESPONSE HEADER -- never in
// the JSON body, so every existing response shape stays byte-identical.
// This module is the ONE place that remembers a handle and swaps `dataset`
// for `dataset_handle` on the way out, wired into `http.ts`'s `postJSON`
// dispatch (not called directly by feature code) -- which is why every
// caller gets the saving for free, including `lib/api.ts`'s five older
// rsm* wrappers (analyzeRsm, rsmLinecut, rsmCutSegment, rsmProjection): that
// file is pinned shrink-only (architecture.test.ts) and must never be
// touched to "opt in" to something new.
//
// Handle = the server's content hash of the dataset it received (routes/
// _datasetcache.py hashes the DECODED ndarray buffers -- ~13ms measured for
// a 45 MB payload against an already-paid ~1.15s decode, negligible).
// Client-side hashing was measured and rejected: this frontend keeps
// `DataStruct.values` as plain nested `number[][]` (lib/types.ts), not
// typed arrays, so a client hash pass would traverse boxed doubles --
// timed in a V8 proxy (Node) at 22.8ms for SHA-256 over an already-
// stringified 45.8 MB JSON string versus 5.5ms hashing the SAME data as raw
// Float64Array buffers -- i.e. even the "smart" typed-array path is only
// cheap when the data is ALREADY typed, which this frontend's DataStruct is
// not, and the naive string-hash path costs on the same order as the
// JSON.stringify (160ms in the same measurement) this cache exists to
// avoid. That cost buys a benefit (deduplicating byte-identical content
// arriving from two different client-side objects) the real workflow never
// needs: channel switches and the angle/Q toggle keep reusing the SAME
// in-memory DataStruct object every time. A WeakMap keyed on that object
// reference captures the entire measured saving with zero client hashing,
// zero canonicalization to keep in sync with the server's hash algorithm,
// and it self-evicts -- an unreferenced dataset's remembered handle is
// collected right along with the object, with no invalidation path to
// forget.
//
// Graceful miss (the single most important correctness property here): an
// unknown/evicted handle comes back as HTTP 409 (routes/_datasetcache.py's
// DatasetHandleMiss). On exactly that status this module re-sends the full
// `dataset` ONCE and remembers the fresh handle from that retry's response
// -- transparent to every caller; the user never sees a cache-eviction
// failure.

import type { HttpError } from "./http";

/** The low-level fetch primitive this module drives: POST JSON, parse the
 *  body as `T`, and hand back whatever `X-Dataset-Handle` header (if any)
 *  came with it. Injected by `http.ts` rather than imported from it, purely
 *  to avoid a runtime import cycle (this module's only import from
 *  `./http` is the `HttpError` TYPE, elided at build time). */
export type RawFetchJSON = <T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
) => Promise<{ value: T; handle: string | null }>;

// Object reference -> the handle the server last echoed back for it. A
// caller that keeps passing the SAME `dataset` object (the normal case: the
// frontend treats a loaded DataStruct as immutable-per-load, replaced
// wholesale on reimport rather than mutated) gets the handle for free on
// every call after the first.
const handles = new WeakMap<object, string>();

/** Paths that opt into the handle cache -- a narrow allowlist, not "any
 *  body with a `dataset` field": /api/corrections/apply, /api/export/* and
 *  others also carry a `dataset` field for unrelated reasons (one-shot
 *  operations, not a repeat-fetch loop) and must not be silently rewritten
 *  -- rewriting THEM would mean their `dataset` field never round-trips
 *  through this cache's storage at all, so a stale/evicted handle could
 *  never even arise, but it would also mean a legitimate one-off caller
 *  starts depending on cache state it has no business depending on.
 *  /api/plot/series (P3.5) now DOES belong here: `routes/plot.py`'s
 *  `PlotRequest` extends `CachedDatasetRequest` (same `dataset`/
 *  `dataset_handle` contract as map/rsm), because a committed zoom/pan on
 *  an already server-decimated series re-POSTs the full dataset on every
 *  step -- measured 1M x 7 rows costing ~80 MB/request, 2.25s json.loads +
 *  0.5s DataStruct.from_dict server-side, plus a main-thread
 *  JSON.stringify client-side, for a dataset that never actually changed.
 *  /api/rsm/strain matches the prefix but never carries a `dataset` field
 *  (it takes q_sub/q_film directly), so it falls through
 *  `postJSONDatasetAware` unchanged below -- no explicit exclusion needed. */
export function isDatasetCachePath(path: string): boolean {
  return path === "/api/plot/map" || path === "/api/plot/series" || path.startsWith("/api/rsm/");
}

function datasetKey(body: unknown): object | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const dataset = (body as Record<string, unknown>).dataset;
  return typeof dataset === "object" && dataset !== null ? (dataset as object) : undefined;
}

/** Dataset-cache-aware POST for a cache-eligible path: swaps a remembered
 *  `dataset` for its `dataset_handle` when one is known, restores the full
 *  payload once on a 409 (unknown/evicted handle), and remembers whatever
 *  handle the server echoes back. A `body` with no `dataset`-shaped field
 *  (e.g. /api/rsm/strain) passes straight through untouched. */
export async function postJSONDatasetAware<T>(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  rawFetch: RawFetchJSON,
): Promise<T> {
  const key = datasetKey(body);
  if (!key) return (await rawFetch<T>(path, body, signal)).value;

  const record = body as Record<string, unknown>;
  const send = (useHandle: boolean): Promise<{ value: T; handle: string | null }> => {
    const handle = useHandle ? handles.get(key) : undefined;
    // `undefined`-valued keys are dropped by JSON.stringify -- this is how
    // `dataset`/`dataset_handle` are swapped on the wire without allocating
    // two differently-shaped body objects by hand.
    const wireBody =
      handle !== undefined
        ? { ...record, dataset: undefined, dataset_handle: handle }
        : { ...record, dataset_handle: undefined };
    return rawFetch<T>(path, wireBody, signal);
  };

  try {
    const first = await send(true);
    if (first.handle) handles.set(key, first.handle);
    return first.value;
  } catch (err) {
    // A 409 with no remembered handle would mean the FULL dataset was
    // already what got sent -- the server can't miss on that, so this
    // guard only ever fires for a genuine unknown/evicted handle.
    if ((err as HttpError).status !== 409 || !handles.has(key)) throw err;
    const retry = await send(false); // resend the full dataset exactly once
    if (retry.handle) handles.set(key, retry.handle);
    return retry.value;
  }
}
