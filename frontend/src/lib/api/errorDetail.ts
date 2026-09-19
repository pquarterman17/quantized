// Renders a backend error body's `detail` into ONE short human line.
//
// WHY THIS EXISTS. `./http`'s `ensureOk` used to read the body as
// `{ detail?: string }` and assign `j.detail` straight into the message. That
// cast is unchecked, and FastAPI's 422 does NOT send a string: it sends an
// ARRAY of validation errors (`schema.d.ts` says so — `detail?:
// components["schemas"]["ValidationError"][]`), one entry per offending
// element. Assigning that array to a `string` and interpolating it produced
// literally `[object Object],[object Object],[object Object],[object Object]`
// in the UI — measured on a magnetometry background subtraction whose loop
// carried four NaN gaps (BUG-021). `ensureOk` is the SINGLE error-extraction
// path for every backend fetch in the app, so that rendering was reachable
// from every endpoint, not just this one.
//
// WHY IT IS A SEPARATE, DYNAMICALLY IMPORTED MODULE. `./http` is eager (the
// entry graph reaches it through the store), and the eager-JS ratchet in
// `frontend/scripts/check-bundle-size.mjs` had 714 bytes of headroom when this
// landed. Formatting only ever runs on a FAILED response, so `ensureOk`
// `await import()`s this on that path alone and the bytes live in a lazy
// chunk. The string case — by far the most common backend error — is handled
// inline in `ensureOk` and never loads this module at all.
//
// CONTRACT. `formatErrorDetail` returns a non-empty string, or `null` when the
// detail carries nothing worth showing (so the caller keeps its status line).
// It NEVER throws: it runs while another error is already being reported, and
// a malformed error body must not replace a real HTTP failure with a
// TypeError.

/** Longest `loc`-path + message list rendered before the tail is summarised. */
const MAX_ENTRIES = 3;

/** `["body", "moment", 7]` -> `"body.moment.7"`. A non-array or empty `loc`
 *  yields `""`, and the caller then renders the message on its own. */
function formatLoc(loc: unknown): string {
  if (!Array.isArray(loc)) return "";
  return loc
    .filter((p) => typeof p === "string" || typeof p === "number")
    .join(".");
}

/** One entry of a FastAPI `detail` array -> `"body.moment.7: Input should be a
 *  valid number"`, or just the message when there is no usable `loc`. An entry
 *  that is a bare string is used as-is; anything else falls back to its JSON,
 *  which is still readable and never `[object Object]`. */
function formatEntry(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry === null || typeof entry !== "object") return safeJson(entry);
  const rec = entry as Record<string, unknown>;
  const msg =
    typeof rec["msg"] === "string"
      ? rec["msg"]
      : typeof rec["message"] === "string"
        ? rec["message"]
        : "";
  const loc = formatLoc(rec["loc"]);
  if (msg && loc) return `${loc}: ${msg}`;
  if (msg) return msg;
  if (loc) return loc;
  return safeJson(entry);
}

/** `JSON.stringify` that cannot throw (a cyclic or BigInt-bearing body). */
function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** A backend `detail` of any shape -> one short line, or `null` when it holds
 *  nothing to show. Array details are deduplicated (a series with the same
 *  complaint on every gap would otherwise repeat one sentence once per gap)
 *  and capped at {@link MAX_ENTRIES}. Whenever that leaves anything out, the
 *  line ends with the TOTAL entry count rather than a "+N more" computed off
 *  the deduplicated lines — with 400 identical complaints, "(400 problems in
 *  total)" is true and "(+397 more)" would not be. */
export function formatErrorDetail(detail: unknown): string | null {
  try {
    if (detail == null) return null;
    if (typeof detail === "string") return detail || null;
    if (Array.isArray(detail)) {
      if (detail.length === 0) return null;
      const lines: string[] = [];
      for (const entry of detail) {
        const line = formatEntry(entry);
        if (line && !lines.includes(line)) lines.push(line);
        if (lines.length >= MAX_ENTRIES) break;
      }
      if (lines.length === 0) return null;
      const shown = lines.join("; ");
      return detail.length > lines.length
        ? `${shown} (${detail.length} problems in total)`
        : shown;
    }
    if (typeof detail === "object") return formatEntry(detail) || null;
    return String(detail) || null;
  } catch {
    return null; // never let the error path throw over the real error
  }
}
