// Upload with a byte fraction (RESULT_ACCEPTANCE_AUDIT part 4, row 5).
// `fetch` exposes no upload progress, so an import that wants a percent goes
// through XMLHttpRequest instead; every other upload keeps using `fetch`.
// The response is wrapped back into a `Response` so the one error-extraction
// path (`ensureOk`) and the dataset-handle bookkeeping stay shared with
// `postImport`. Loaded on demand from `lib/api.ts`'s `uploadFile`.
//
// `onProgress(f)`: f in [0, 1) while bytes go up, then exactly 1 once the
// server has the whole body and is parsing it. The backend has no parse
// fraction to give (one synchronous parse per request), so "parsing" is a
// stage, not a percent (provisional, owner to confirm).

import { rememberHandle } from "./datasetCache";
import { ensureOk } from "./http";

export async function postImportWithProgress<T extends object>(
  path: string,
  form: FormData,
  signal: AbortSignal | undefined,
  onProgress: (fraction: number) => void,
): Promise<T> {
  const res = await new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const aborted = () => new DOMException("aborted", "AbortError");
    if (signal?.aborted) return reject(aborted());
    xhr.open("POST", path);
    xhr.responseType = "arraybuffer"; // bytes straight into the Response: no string copy of a large body
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0 && e.loaded < e.total) onProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => onProgress(1);
    const onAbort = (): void => xhr.abort();
    // Settled either way: drop the listener (a batch shares ONE signal across every upload).
    const settle = (): void => signal?.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      settle();
      const headers = new Headers();
      const handle = xhr.getResponseHeader("X-Dataset-Handle");
      if (handle) headers.set("X-Dataset-Handle", handle);
      // A null-body status (204 etc.) cannot carry text; none of these routes sends one.
      resolve(new Response(xhr.response as ArrayBuffer, { status: xhr.status, statusText: xhr.statusText, headers }));
    };
    xhr.onerror = () => {
      settle();
      reject(new TypeError("Failed to fetch"));
    };
    xhr.onabort = () => {
      settle();
      reject(aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(form);
  });
  const ok = await ensureOk(res);
  const value = (await ok.json()) as T;
  rememberHandle(value, ok.headers.get("X-Dataset-Handle"));
  return value;
}
