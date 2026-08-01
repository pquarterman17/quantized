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

import { filenameFromDisposition, saveBlob } from "../download";

/** `signal` is optional and threads through to `fetch` unchanged (undefined
 *  is a normal, no-op `RequestInit.signal`) — added for the import-cancel
 *  path (P3.4 slice 1); every other caller is unaffected. */
export async function postJSON<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return unwrap<T>(res);
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
    throw new Error(detail);
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
