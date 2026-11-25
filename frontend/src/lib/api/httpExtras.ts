// The lazy-only half of http.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the POST-typed and DELETE helpers. Only lazy modules and tests call it.
// The code moved here verbatim and http.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { postJSON, unwrap, type ApiPath, type RequestBodyOf, type ResponseOf } from "./http";

/** Typed sibling of `postJSON`: the path must be a real backend POST route,
 *  and `body` must match that route's declared request schema. Delegates to
 *  `postJSON` unchanged (same dataset-cache interception, same error
 *  behavior) — this only narrows the two type parameters at the call site. */
export function postApi<P extends ApiPath>(path: P, body: RequestBodyOf<P>, signal?: AbortSignal): Promise<ResponseOf<P>> {
  return postJSON<ResponseOf<P>>(path, body, signal);
}

export async function deleteJSON<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path, { method: "DELETE" }));
}
