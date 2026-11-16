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
import { PALETTE_SHORTCUT } from "../store/commands";
import { formatShortcut, isMacPlatform } from "./shortcutFormat";

/** Binary containers the wizard cannot read, by lower-cased extension. */
const BINARY_EXTS: ReadonlySet<string> = new Set([
  // Origin projects, windows, templates, packages
  ".opj", ".opju", ".ogw", ".ogwu", ".ogg", ".oggu", ".ogm", ".ogmu",
  ".otw", ".otwu", ".otm", ".otmu", ".otp", ".otpu", ".opx",
  // other binary containers with their own parsers
  ".xlsx", ".xls", ".h5", ".hdf5", ".nxs", ".nc", ".brml", ".raw", ".spc", ".opus",
  ".mat", ".ibw", ".png", ".tif", ".tiff", ".jpg", ".jpeg",
]);

/** The real cause and remedy for an error that never reached the backend's
 *  code — the server is down (`fetch` rejected: "Failed to fetch" in Chrome,
 *  "NetworkError…" in Firefox, "Load failed" in Safari) or this page's token
 *  is stale (a relaunched `qz` mints a new one, so every call is 401) — as a
 *  " — …" suffix, or "" for any other error. Shared by the import summary and
 *  the workshops' own error lines (Curve Fit, Peaks), which said only
 *  "Failed to fetch". */
export function connectionHint(message: string): string {
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return " — the qz server is not responding (if you relaunched qz, reload this page)";
  }
  return /invalid API token/i.test(message) ? " — qz was relaunched; reload this page" : "";
}

/** Whether the Import wizard can help with a failed import of `name`: a
 *  text-like file whose failure reached a parser (not a down server / stale
 *  token, and not a binary container). */
export function wizardCanRead(name: string, message = ""): boolean {
  const kind = failureKind(message, name);
  return (kind === "unrecognised" || kind === "parse") && !isBinaryName(name);
}

export const isBinaryName = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  return BINARY_EXTS.has(dot >= 0 ? name.slice(dot).toLowerCase() : "");
};

/** What kind of failure an error message describes: only the last two reached
 *  a parser, so only those are the file's content and worth the wizard. */
export type FailureKind = "server" | "missing" | "denied" | "servererror" | "unrecognised" | "parse";
export function failureKind(error: string, name = ""): FailureKind {
  // The batch error is "<file name>: <message>": classify the message only, or a
  // file called "permission_slip.dat" would read as a permission failure.
  const message = name && error.startsWith(`${name}: `) ? error.slice(name.length + 2) : error;
  if (connectionHint(message)) return "server";
  if (/\b(file|path|directory)\b[^:]{0,40}\bnot found|no such file|enoent|\b(http|status)[ :]*404\b|404 not found/i.test(message)) return "missing";
  if (/permission denied|eacces|\b(http|status)[ :]*403\b|403 forbidden|access is denied/i.test(message)) return "denied";
  if (/internal server error|\bhttp 5\d\d\b|\b5\d\d (error|server)/i.test(message)) return "servererror";
  return /no parser registered/i.test(message) ? "unrecognised" : "parse";
}

/** The hint for a failed import of `name`: the wizard for a text-like file,
 *  nothing for a binary container (its error already says what to do).
 *  Soak-test fix: a failure that never reached a parser is not the file's
 *  fault, so `message` (the error text) is checked first — a server that is
 *  down (`fetch` rejected) or a stale token (a relaunched `qz` mints a new
 *  one, so every call is 401) gets its real cause and remedy, never the
 *  wizard, which would fail the same way. */
export function importFailureHint(name: string, message = "", isMac: boolean = isMacPlatform()): string {
  const cause = connectionHint(message);
  if (cause) return cause;
  return !wizardCanRead(name, message) ? "" : ` — try the Import wizard (${formatShortcut(PALETTE_SHORTCUT, isMac)} → Import wizard…)`;
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
