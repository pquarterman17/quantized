// An import batch's one-line summary and the "what next" a failed import's
// status/toast appends (store/importDatasets.ts; moved here with the summary
// when that module reached its .ts ceiling).
//
// The Import wizard is the second front door for a TEXT file the auto-detect
// path could not read (#40) — it guesses delimiters and headers over the
// file's text. It cannot read a binary container, so pointing a broken Origin
// project (or an Origin window/template, an Excel/HDF5 file, …) at it was bad
// advice (audit 2026-11: a corrupt .opju said "try the Import wizard"). Those
// failures carry their own, format-specific advice in the server's message.

import { plural } from "./plural";

/** Binary containers the wizard cannot read, by lower-cased extension. */
const BINARY_EXTS: ReadonlySet<string> = new Set([
  // Origin projects, windows, templates, packages
  ".opj", ".opju", ".ogw", ".ogwu", ".ogg", ".oggu", ".ogm", ".ogmu",
  ".otw", ".otwu", ".otm", ".otmu", ".otp", ".otpu", ".opx",
  // other binary containers with their own parsers
  ".xlsx", ".xls", ".h5", ".hdf5", ".nxs", ".nc", ".brml", ".raw", ".spc", ".opus",
  ".mat", ".ibw", ".png", ".tif", ".tiff", ".jpg", ".jpeg",
]);

/** The hint for a failed import of `name`: the wizard for a text-like file,
 *  nothing for a binary container (its error already says what to do).
 *  Soak-test fix: a failure that never reached a parser is not the file's
 *  fault, so `message` (the error text) is checked first — a server that is
 *  down (`fetch` rejected) or a stale token (a relaunched `qz` mints a new
 *  one, so every call is 401) gets its real cause and remedy, never the
 *  wizard, which would fail the same way. */
export function importFailureHint(name: string, message = ""): string {
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return " — the qz server is not responding (if you relaunched qz, reload this page)";
  }
  if (/invalid API token/i.test(message)) return " — qz was relaunched; reload this page";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return BINARY_EXTS.has(ext) ? "" : " — try the Import wizard (⌘K → Import wizard…)";
}

/** The batch summary for status and toast. A parse failure is the wizard's
 *  second front door (#40): the auto-detect path gave up, so point at the
 *  manual guess/preview/parse one instead of just reporting the error -- for
 *  a text-like file only (`importFailureHint`). */
export function importSummary(added: number, total: number, lastError: string, lastFailed: string): string {
  return lastError
    ? `imported ${added}/${total} — failed ${lastError}${importFailureHint(lastFailed, lastError)}`
    : `imported ${added} file${plural(added)}`;
}
