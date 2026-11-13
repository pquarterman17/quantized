// The "what next" a failed import's status/toast appends (store/importDatasets.ts).
//
// The Import wizard is the second front door for a TEXT file the auto-detect
// path could not read (#40) — it guesses delimiters and headers over the
// file's text. It cannot read a binary container, so pointing a broken Origin
// project (or an Origin window/template, an Excel/HDF5 file, …) at it was bad
// advice (audit 2026-11: a corrupt .opju said "try the Import wizard"). Those
// failures carry their own, format-specific advice in the server's message.

/** Binary containers the wizard cannot read, by lower-cased extension. */
const BINARY_EXTS: ReadonlySet<string> = new Set([
  // Origin projects, windows, templates, packages
  ".opj", ".opju", ".ogw", ".ogwu", ".ogg", ".oggu", ".ogm", ".ogmu",
  ".otw", ".otwu", ".otm", ".otmu", ".otp", ".otpu", ".opx",
  // other binary containers with their own parsers
  ".xlsx", ".xls", ".h5", ".hdf5", ".nxs", ".nc", ".brml", ".raw", ".spc", ".opus",
]);

/** The hint for a failed import of `name`: the wizard for a text-like file,
 *  nothing for a binary container (its error already says what to do). */
export function importFailureHint(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return BINARY_EXTS.has(ext) ? "" : " — try the Import wizard (⌘K → Import wizard…)";
}
