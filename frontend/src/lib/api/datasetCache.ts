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
import type { DataStruct } from "../types";

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

/** Remember the handle an import route (`/api/parsers/import|upload`) sent for
 *  the dataset it just returned: the server already holds what it parsed, so
 *  the first plot sends the handle, not every row (1M x 6: ~5 s of JSON). A
 *  later 409 falls back to the full upload like any other stale handle. */
export function rememberHandle(dataset: object, handle: string | null): void {
  if (handle) handles.set(dataset, handle);
}

/** Paths that opt into the handle cache -- a narrow allowlist, not "any
 *  body with a `dataset` field": /api/corrections/apply, most /api/export/* and
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
 *  /api/export/figure-hitmap belongs here for the same reason: it is the
 *  Figure Builder's live preview, re-rendered on every property edit
 *  (`FigureRequest` extends `CachedDatasetRequest`). /api/export/figure
 *  itself stays OUT: a download is one-shot (and goes through
 *  postDownload/postBlob, which never consult this allowlist); the backend
 *  accepts a handle there but does not cache a posted dataset for it.
 *  /api/rsm/strain matches the prefix but never carries a `dataset` field
 *  (it takes q_sub/q_film directly), so it falls through
 *  `postJSONDatasetAware` unchanged below -- no explicit exclusion needed. */
export function isDatasetCachePath(path: string): boolean {
  return (
    path === "/api/plot/map" ||
    path === "/api/plot/series" ||
    path === "/api/export/figure-hitmap" ||
    path.startsWith("/api/rsm/")
  );
}

function datasetKey(body: unknown): object | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const dataset = (body as Record<string, unknown>).dataset;
  return typeof dataset === "object" && dataset !== null ? (dataset as object) : undefined;
}

/** Object -> the in-flight request uploading it, which settles with the
 *  handle it earned (null: failed, aborted, or too large to cache). At most
 *  one per object, shared by every caller -- see `whenIdle`. */
const pending = new WeakMap<object, Promise<string | null>>();

const abortError = (): DOMException => new DOMException("aborted", "AbortError");

/** Run `next` once no upload of `key` is in flight. PERF (cell-edit
 *  re-upload audit): the focused plot and each background plot window fetch
 *  the same new DataStruct in the same tick; before this each missed the
 *  handle cache and uploaded the whole dataset in parallel (1M x 7: 1.53 s
 *  JSON.stringify plus a 156 MB POST, per window).
 *
 *  `next` runs SYNCHRONOUSLY after the final "nothing pending" check, with
 *  no await in between, so an `upload` it starts is registered before any
 *  other waiter can re-check. That is also why this loops: a failed upload
 *  hands over to the first waiter to wake, and the rest wait for that one.
 *  Rejects with an AbortError as soon as the caller's own `signal` aborts,
 *  rather than waiting out someone else's upload. */
async function whenIdle<R>(key: object, signal: AbortSignal | undefined, next: () => Promise<R>): Promise<R> {
  for (let p = pending.get(key); p; p = pending.get(key)) {
    if (signal?.aborted) throw abortError();
    if (!signal) {
      await p;
      continue;
    }
    let onAbort = (): void => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([p, aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  if (signal?.aborted) throw abortError();
  return next();
}

type Wire<T> = Promise<{ value: T; handle: string | null }>;
type Send<T> = (extra: Record<string, unknown>) => Wire<T>;

const isMiss = (err: unknown): boolean => (err as HttpError | null)?.status === 409;

/** Child DataStruct -> the dataset it was cell-edited from (see
 *  `noteCellEdit`). Dropped once the child earns its own handle, so a child
 *  keeps at most one ancestor alive, and only until its first upload. */
const derived = new WeakMap<object, object>();

/** Record that `child` is `parent` with some cells edited (store/cellEdit.ts
 *  calls this). When `child` is first sent, and the server holds `parent`, only
 *  the changed cells are uploaded -- see ./datasetPatch. A `parent` that was
 *  never sent is skipped over to ITS parent, so a burst of edits before a plot
 *  fetch still patches from the last dataset the server saw. */
export function noteCellEdit(parent: DataStruct, child: DataStruct): void {
  if (parent === child) return;
  const known = handles.has(parent) || pending.has(parent);
  derived.set(child, known ? parent : (derived.get(parent) ?? parent));
}

const PATCH_PATH = "/api/datasets/patch";

/** A handle for `key` built server-side from its recorded parent plus cell
 *  patches, or null when that is not possible (no parent, parent never sent,
 *  shape change, too many cells, parent evicted) and the caller should send
 *  the full dataset. Rejects only on abort. */
async function patchedHandle(key: object, signal: AbortSignal | undefined, rawFetch: RawFetchJSON): Promise<string | null> {
  const base = derived.get(key);
  if (!base || !(handles.has(base) || pending.has(base))) return null;
  // Lazy: the diff only runs for an edited dataset, so it stays out of the eager bundle.
  const { cellPatches } = await import("./datasetPatch");
  const patches = cellPatches(base as DataStruct, key as DataStruct);
  if (!patches) return null;
  const parent = await whenIdle(base, signal, async () => handles.get(base));
  if (parent === undefined) return null;
  try {
    const { value } = await rawFetch<{ dataset_handle: string | null }>(
      PATCH_PATH,
      { dataset_handle: parent, patches },
      signal,
    );
    return value.dataset_handle;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (isMiss(err) && handles.get(base) === parent) handles.delete(base);
    return null; // a full upload is always a correct answer
  }
}

/** THE upload of `key`: cell patches against its parent when possible (see
 *  `patchedHandle`), else the full `dataset`. Registered in `pending`
 *  synchronously, before the first await, so a concurrent caller sees it and
 *  waits instead of uploading the same object again. */
async function upload<T>(key: object, send: Send<T>, viaPatch: () => Promise<string | null>): Promise<T> {
  let done: (handle: string | null) => void = () => {};
  const p = new Promise<string | null>((resolve) => (done = resolve));
  pending.set(key, p);
  let earned: string | null = null;
  try {
    const patched = await viaPatch();
    if (patched !== null) {
      try {
        const res = await send({ dataset: undefined, dataset_handle: patched });
        handles.set(key, (earned = res.handle ?? patched));
        return res.value;
      } catch (err) {
        if (!isMiss(err)) throw err; // evicted in between: fall through to a full upload
      }
    }
    const res = await send({ dataset_handle: undefined });
    if (res.handle) handles.set(key, (earned = res.handle));
    return res.value;
  } finally {
    if (pending.get(key) === p) pending.delete(key);
    if (earned !== null) derived.delete(key);
    done(earned);
  }
}

/** Dataset-cache-aware POST for a cache-eligible path: swaps a remembered
 *  `dataset` for its `dataset_handle` when one is known, uploads the full
 *  payload once per object even under concurrent callers (see `whenIdle`),
 *  restores the full payload once on a 409 (unknown/evicted handle), and
 *  remembers whatever handle the server echoes back. A `body` with no
 *  `dataset`-shaped field (e.g. /api/rsm/strain) passes straight through
 *  untouched. */
export async function postJSONDatasetAware<T>(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  rawFetch: RawFetchJSON,
): Promise<T> {
  const key = datasetKey(body);
  if (!key) return (await rawFetch<T>(path, body, signal)).value;

  const record = body as Record<string, unknown>;
  // `undefined`-valued keys are dropped by JSON.stringify -- this is how
  // `dataset`/`dataset_handle` are swapped on the wire without allocating
  // two differently-shaped body objects by hand.
  const send: Send<T> = (extra) => rawFetch<T>(path, { ...record, ...extra }, signal);
  const byHandle = async (handle: string): Promise<T> =>
    (await send({ dataset: undefined, dataset_handle: handle })).value;
  const viaPatch = () => patchedHandle(key, signal, rawFetch);

  const handleOrUpload = (): Promise<T> => {
    const h = handles.get(key);
    return h === undefined ? upload(key, send, viaPatch) : byHandle(h);
  };

  return whenIdle(key, signal, async () => {
    const known = handles.get(key);
    if (known === undefined) return upload(key, send, viaPatch);
    try {
      return await byHandle(known);
    } catch (err) {
      // A 409 on a full upload re-throws from `upload` itself (the server
      // cannot miss on a payload it was just given); only a remembered
      // handle can have gone stale.
      if (!isMiss(err)) throw err;
      // Evicted server-side: resend the full dataset once -- unless a
      // concurrent caller already did, in which case use what it earned.
      if (handles.get(key) === known) handles.delete(key);
      return whenIdle(key, signal, handleOrUpload);
    }
  });
}
