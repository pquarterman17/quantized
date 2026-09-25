// Large-workbook Copy/Paste over a guarded temporary package (LIBRARY_WORKBOOK_
// UX_PLAN "Cross-session workbook transfer requirements" box 5, "Group F").
//
// Up to `MAX_TRANSFER_PACKAGE_CHARS` (lib/workbookTransfer.ts) Copy still puts
// the whole versioned package on the clipboard as text — byte-for-byte what
// PR I shipped. ABOVE it, instead of refusing, Copy stores the package through
// the backend's transfer store (`POST /api/workbook-transfer/packages`,
// src/quantized/io/workbook_transfer_store.py) and puts only a small versioned
// DESCRIPTOR on the clipboard: format + version, the package id, its secret
// token, its byte size, its expiry, and a human summary line (what a user sees
// if they paste it into a text editor). Paste recognises the descriptor,
// fetches the package back through ITS OWN backend — a second Quantized
// process may run a separate backend on another port; the two share only the
// on-disk store — and hands the text to the SAME `parseTransferPackage`
// validation an inline package gets. So the clipboard never carries an
// unbounded payload, and a fetched package is exactly as trusted as a pasted
// one: not at all, until it parses.
//
// Why this is not the write authority PR I deferred: see the backend module's
// "Write authority" section — the caller sends bytes, never a path; the store
// picks the (Quantized-owned cache) directory and mints the id; size, count and
// lifetime are bounded server-side.
//
// Failure is always a refusal with a reason, never a partial result: store
// unreachable (offline/no backend) on Copy, and missing / expired / truncated /
// incompatible on Paste, all return `{ ok: false, reason }` BEFORE the store
// slice touches history or state (store/workbookTransfer.ts's contract).
//
// Loaded only by lib/workbookTransfer.ts, itself a lazy seam — so none of this
// ships in the eager bundle (architecture.test.ts, DRAGGED_OUT).

import { unwrap } from "./api/http";
import type { components } from "./api/schema";
import { plural } from "./plural";
import type { BuildTransferResult, ParseTransferResult, WorkbookTransferPackage } from "./workbookTransfer";

export const WORKBOOK_TRANSFER_REF_FORMAT = "quantized-workbook-transfer-ref";
export const WORKBOOK_TRANSFER_REF_VERSION = 1;
/** Mirrors the backend's `MAX_PACKAGE_BYTES` — refused here first so a
 *  hopeless upload is never attempted. */
export const MAX_STORED_TRANSFER_BYTES = 128_000_000;
/** A descriptor is a few hundred characters; anything longer is not one, and
 *  is not even JSON-parsed as a candidate. */
const MAX_REF_CHARS = 4096;
const PACKAGES = "/api/workbook-transfer/packages";
const ID_RE = /^[0-9a-f]{32}$/;
/** Exactly what the server mints (`secrets.token_urlsafe(32)`). Anything
 *  else never reaches `fetch`: a `\n` or non-Latin-1 header value makes
 *  it throw, which would surface as a false "store unavailable". */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const AGAIN = "copy the workbook again in the source window";
/** Keeps the descriptor far under `MAX_REF_CHARS` whatever the name. */
const MAX_SUMMARY_NAME = 80;

export interface WorkbookTransferRef {
  format: typeof WORKBOOK_TRANSFER_REF_FORMAT;
  version: number;
  summary: string;
  id: string;
  token: string;
  size: number;
  expiresAt: string;
}

type Stored = components["schemas"]["StoredPackageResponse"];
export type ReadRefResult = { ok: true; ref: WorkbookTransferRef } | { ok: false; reason: string };

const mb = (n: number): string => `${(n / 1_000_000).toFixed(1)} MB`;
const why = (e: unknown): string => (e instanceof Error ? e.message : "error");

/** The descriptor in `text`, a refusal for a descriptor this build cannot use
 *  (unsupported version, malformed fields), or `null` when `text` is not a
 *  descriptor at all — the caller then treats it as an inline package. */
export function readTransferRef(text: string): ReadRefResult | null {
  if (text.length > MAX_REF_CHARS) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const r = o as Record<string, unknown>;
  if (r.format !== WORKBOOK_TRANSFER_REF_FORMAT) return null;
  if (r.version !== WORKBOOK_TRANSFER_REF_VERSION) {
    return { ok: false, reason: `unsupported workbook transfer reference version: ${String(r.version)}` };
  }
  const { id, token, size, expiresAt, summary } = r;
  if (
    typeof id !== "string" ||
    !ID_RE.test(id) ||
    typeof token !== "string" ||
    !TOKEN_RE.test(token) ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size <= 0 ||
    typeof expiresAt !== "string" ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    return { ok: false, reason: "clipboard text is not a valid Quantized transfer descriptor" };
  }
  return {
    ok: true,
    ref: {
      format: WORKBOOK_TRANSFER_REF_FORMAT,
      version: WORKBOOK_TRANSFER_REF_VERSION,
      summary: typeof summary === "string" ? summary : "",
      id,
      token,
      size,
      expiresAt,
    },
  };
}

/** Store an over-inline-size package and return the DESCRIPTOR as the text to
 *  put on the clipboard (same `BuildTransferResult` shape as an inline copy,
 *  so the caller cannot tell the transports apart except by size). */
export async function storeAsReference(
  built: { pkg: WorkbookTransferPackage; text: string },
  inlineLimit: number,
  cap = MAX_STORED_TRANSFER_BYTES,
): Promise<BuildTransferResult> {
  const body = new Blob([built.text], { type: "application/json" });
  if (body.size > cap) {
    return { ok: false, reason: `workbook is too large to transfer (${mb(body.size)}, limit ${mb(cap)})` };
  }
  let stored: Stored;
  try {
    stored = await unwrap<Stored>(
      await fetch(PACKAGES, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
    );
  } catch (e) {
    return {
      ok: false,
      reason:
        `workbook is ${mb(body.size)}, over the ${mb(inlineLimit)} clipboard limit, ` +
        `and the temporary transfer store is unavailable (${why(e)})`,
    };
  }
  if (!ID_RE.test(stored.id) || !TOKEN_RE.test(stored.token) || stored.size !== body.size) {
    return { ok: false, reason: "the temporary transfer store returned an unexpected response" };
  }
  const n = built.pkg.datasets.length;
  const title = built.pkg.workbook.name;
  const shown = title.length > MAX_SUMMARY_NAME ? `${title.slice(0, MAX_SUMMARY_NAME)}…` : title;
  const ref: WorkbookTransferRef = {
    format: WORKBOOK_TRANSFER_REF_FORMAT,
    version: WORKBOOK_TRANSFER_REF_VERSION,
    summary:
      `Quantized workbook "${shown}" (${n} worksheet${plural(n)}, ${mb(body.size)}) ` +
      `- paste into Quantized before ${stored.expires_at}`,
    id: stored.id,
    token: stored.token,
    size: stored.size,
    expiresAt: stored.expires_at,
  };
  const until = new Date(stored.expires_at).toLocaleString();
  return {
    ok: true,
    pkg: built.pkg,
    text: JSON.stringify(ref),
    note: ` via a temporary transfer package — paste before ${until}`,
    // Best effort: an unreachable package also ages out on its own.
    discard: () =>
      fetch(`${PACKAGES}/${stored.id}`, { method: "DELETE", headers: { "X-Transfer-Token": stored.token } }).then(
        () => undefined,
        () => undefined,
      ),
  };
}

/** Fetch the package a descriptor names and validate it with `parse` (the
 *  caller's `parseTransferPackage`, injected so this module never value-
 *  imports the lazy seam that imports it). Every failure is a reason. */
export async function fetchReferencedPackage(
  ref: WorkbookTransferRef,
  parse: (text: string) => ParseTransferResult,
  now: () => number = Date.now,
): Promise<ParseTransferResult> {
  let res: Response;
  let bytes: ArrayBuffer;
  try {
    res = await fetch(`${PACKAGES}/${ref.id}`, { headers: { "X-Transfer-Token": ref.token } });
    if (res.status === 410 || (res.status === 404 && now() >= Date.parse(ref.expiresAt))) {
      return { ok: false, reason: `the copied workbook's temporary transfer package expired (${ref.expiresAt}) — ${AGAIN}` };
    }
    if (res.status === 404) {
      return {
        ok: false,
        reason: `the copied workbook's temporary transfer package is not available here (removed, evicted, or copied on another computer or user account) — ${AGAIN}`,
      };
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
    bytes = await res.arrayBuffer();
  } catch (e) {
    return {
      ok: false,
      reason: `the copied workbook is held in a temporary transfer package and the transfer store is unavailable (${why(e)})`,
    };
  }
  if (bytes.byteLength !== ref.size) {
    return {
      ok: false,
      reason: `the temporary transfer package is incomplete (${bytes.byteLength} of ${ref.size} bytes) — ${AGAIN}`,
    };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "the temporary transfer package is not valid text" };
  }
  const parsed = parse(text);
  return parsed.ok ? parsed : { ok: false, reason: `temporary transfer package: ${parsed.reason}` };
}
