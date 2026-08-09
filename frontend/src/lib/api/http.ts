// Shared transport for the typed backend client (`lib/api.ts` and its
// `lib/api/*` domain siblings). Every backend fetch funnels through
// `ensureOk` here, so error-message behaviour cannot drift between endpoints
// (MAIN #8b — four copies of that block had already drifted once).
//
// Split out of `lib/api.ts` (2026-07-29, JMP_GAP #14) so a domain module can
// reach the helpers WITHOUT importing `lib/api.ts` itself, which would be a
// cycle. `lib/api.ts` re-exports `unwrap`/`postForm` from here, so the
// standalone clients (lib/jobs, lib/fitbumps, lib/originTemplate) keep their
// existing `from "./api"` imports unchanged.
//
// `postJSON` also dispatches to `./datasetCache` for /api/plot/map and
// /api/rsm/* (RSM_CUTS_PLAN item 18) -- see that module's doc for why the
// interception lives HERE rather than in each domain wrapper: it is the one
// function every caller already funnels through, including `lib/api.ts`'s
// pinned-shrink-only rsm* wrappers, which must never be edited to opt in.

import { postJSONDatasetAware, isDatasetCachePath } from "./datasetCache";
import { filenameFromDisposition, saveBlob } from "../download";

/** Thrown by `ensureOk` on a non-2xx response. A plain `Error` subclass (so
 *  every existing `catch (err) { ... err.message }` site is unaffected) that
 *  also carries the HTTP status -- `./datasetCache` needs to tell "unknown
 *  dataset handle" (409) apart from any other failure without parsing the
 *  message string. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** `signal` is optional and threads through to `fetch` unchanged (undefined
 *  is a normal, no-op `RequestInit.signal`) — added for the import-cancel
 *  path (P3.4 slice 1); every other caller is unaffected. */
export async function postJSON<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (isDatasetCachePath(path)) {
    return postJSONDatasetAware<T>(path, body, signal, fetchJSON);
  }
  return (await fetchJSON<T>(path, body, signal)).value;
}

/** The raw POST-JSON-and-parse primitive, also exposing whatever
 *  `X-Dataset-Handle` response header came back (null on every path that
 *  doesn't send one) -- `./datasetCache` is the only caller that reads the
 *  handle; every other path via `postJSON` just discards it. */
async function fetchJSON<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ value: T; handle: string | null }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const ok = await ensureOk(res);
  const value = (await ok.json()) as T;
  return { value, handle: ok.headers.get("X-Dataset-Handle") };
}

export async function getJSON<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path));
}

export async function deleteJSON<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path, { method: "DELETE" }));
}

/** Pass an ok response through; throw the backend's error detail (or the
 *  status line) otherwise. The SINGLE error-extraction path — every backend
 *  fetch funnels through here (via `unwrap`/`postForm`/`postBlob`/
 *  `postDownload`), so error-message behaviour can't drift between endpoints
 *  (review 2026-07-11, MAIN #8b — four copies of this block had drifted). */
async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new HttpError(res.status, detail);
  }
  return res;
}

/** ok response -> parsed JSON; !ok -> throws the backend's error detail.
 *  Exported for the deliberately-standalone client modules (lib/jobs,
 *  lib/fitbumps) so they share the one extraction path above. */
export async function unwrap<T>(res: Response): Promise<T> {
  return (await (await ensureOk(res)).json()) as T;
}

/** POST a FormData body (browser file uploads) -> JSON. Exported for the
 *  standalone upload clients (lib/originTemplate). `signal` — see postJSON. */
export async function postForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(path, { method: "POST", body: form, signal }));
}

/** POST JSON -> raw response bytes (the server-rendered preview images). */
export async function postBlob(path: string, body: unknown): Promise<Blob> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await ensureOk(res)).blob();
}

/** POST JSON, then download the response body as a file (Content-Disposition
 *  attachment) — the export routes. Lives here rather than lib/download so
 *  its error handling rides `ensureOk`; the DOM save helpers stay in
 *  lib/download (which does no fetching). */
export async function postDownload(path: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const blob = await (await ensureOk(res)).blob();
  saveBlob(blob, filenameFromDisposition(res.headers.get("Content-Disposition"), fallbackName));
}
