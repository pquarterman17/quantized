// Quick Convert: the pure part (names, plain-language errors, one row's status).
// No React, no fetch: unit-tested on its own (quickConvertModel.test.ts).

import type { ConvertEntry, FilePreview } from "../../../lib/api/convertQuick";

/** One row of the file list. `staged` = a dropped / picked File: its bytes live
 *  in a server temp folder, so it has no folder of its own to write next to. */
export interface QcFile {
  id: string;
  path: string;
  name: string;
  staged: boolean;
  phase: "ready" | "staging" | "failed";
  error?: string;
}

export type Tone = "ok" | "warn" | "danger" | "dim";

export interface RowStatus {
  tone: Tone;
  /** Short label for the status cell. */
  label: string;
  /** The longer plain-language reason, when there is one. */
  detail?: string;
}

/** The last path component, `/` or `\`. */
export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Everything before the last component (`""` when there is none). */
export const folderOf = (p: string): string => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : "";
};

/** Where the server-side chooser opens: the output folder when one is typed, else the
 *  folder of the first input that has one, else the user's home. Staged (dropped)
 *  files live in a temp folder, never a place to start browsing. */
export function chooserStart(mode: "files" | "folder", outDir: string, files: { path: string; staged: boolean }[], home: string): string {
  if (mode === "folder" && outDir.trim()) return outDir.trim();
  const first = files.find((f) => !f.staged && folderOf(f.path));
  return first ? folderOf(first.path) : home;
}

/** `join("a/b", "c.csv")` keeping the separator style of `dir`. */
export const joinPath = (dir: string, name: string): string =>
  dir ? `${dir}${dir.includes("\\") && !dir.includes("/") ? "\\" : "/"}${name}` : name;

/** A backend / exception message as a sentence a lab user can act on. The raw
 *  text is never lost: callers keep it as the tooltip. */
export function plainError(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "Not converted.";
  const msg = text.replace(/^[A-Za-z]+(?:Error|Exception|Refused): /, "");
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^file not found/i, () => "The file was not found; it may have been moved or deleted."],
    [/no parser registered for '([^']*)'.*\(extension '([^']*)'\)/i, (m) => `Quantized does not know the ${m[2]} file type (${m[1]}).`],
    [/no parser registered/i, () => "Quantized does not know this file type."],
    [/no data rows/i, () => "The file has a header but no data rows."],
    [/PermissionError|permission denied/i, () => "No permission to write there; pick another output folder."],
    [/NotADirectoryError|not a directory/i, () => "That output location is a file, not a folder."],
    [/No space left/i, () => "The disk is full."],
    [/is outside the allowed folders/i, () => msg],
    [/exists, not overwritten/i, () => "A file with this name already exists, so it was left alone."],
    [/is an input \(or inside one\)/i, () => "That would overwrite an input file, which is never allowed."],
    [/no dataset holds numbers/i, () => "Nothing in this file is numeric, so there is nothing to write."],
    [/writing failed: (?:[A-Za-z]+): (.*)/i, (m) => `Could not write the output: ${m[1]}`],
  ];
  for (const [re, make] of rules) {
    const m = msg.match(re) ?? text.match(re);
    if (m) return make(m);
  }
  return msg.charAt(0).toUpperCase() + msg.slice(1) + (/[.!?]$/.test(msg) ? "" : ".");
}

/** What the file's row says, from the freshest knowledge: a finished run beats a
 *  preview; a preview beats nothing. */
export function rowStatus(
  file: QcFile,
  preview: FilePreview | undefined,
  entry: ConvertEntry | undefined,
  opts: { running: boolean; overwrite: boolean },
): RowStatus {
  if (file.phase === "staging") return { tone: "dim", label: "Uploading…" };
  if (file.phase === "failed") return { tone: "danger", label: "Not added", detail: plainError(file.error) };
  if (entry) {
    const n = entry.outputs.length;
    if (entry.outcome === "done") return { tone: "ok", label: n === 1 ? "Converted" : `Converted (${n} files)` };
    if (entry.outcome === "partial")
      return { tone: "warn", label: "Partly converted", detail: plainError(entry.reason) };
    if (entry.outcome === "skipped-exists")
      return { tone: "warn", label: "Skipped: already exists", detail: "Tick “Replace existing files” to overwrite it." };
    return { tone: "danger", label: "Failed", detail: plainError(entry.reason ?? entry.error) };
  }
  if (opts.running) return { tone: "dim", label: "Queued…" };
  if (!preview) return { tone: "dim", label: "Checking…" };
  if (preview.error) return { tone: "danger", label: "Can’t convert", detail: plainError(preview.error) };
  if (preview.existing.length)
    return opts.overwrite
      ? { tone: "warn", label: "Will replace existing", detail: preview.existing.join(", ") }
      : { tone: "warn", label: "Output exists: will skip", detail: `${preview.existing.join(", ")} already exists.` };
  return { tone: "ok", label: "Ready" };
}

/** "2 converted, 1 skipped, 1 failed" for a finished run. */
export function summaryText(entries: ConvertEntry[]): string {
  const count = (o: ConvertEntry["outcome"]) => entries.filter((e) => e.outcome === o).length;
  const parts: [number, string][] = [
    [count("done"), "converted"],
    [count("partial"), "partly converted"],
    [count("skipped-exists"), "skipped (already exist)"],
    [count("failed"), "failed"],
  ];
  const text = parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`).join(", ");
  return text || "Nothing was converted";
}

/** "a, b [unit]" columns of a dataset, units in brackets when there are any. */
export function columnText(cols: { name: string; unit: string }[]): string {
  return cols.map((c) => (c.unit ? `${c.name} [${c.unit}]` : c.name)).join(", ");
}

/** Short size: "12 B", "3.4 kB", "1.2 MB". */
export function sizeText(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} kB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}
