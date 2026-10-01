// Parser notes after an import. A parser that drops or truncates rows, or
// imports a text column as categorical, records one sentence per problem in
// `metadata.notes` (src/quantized/io/_row_width.py, io/delimited.py). The
// Metadata card shows the full text (lib/metadata.ts); this fires the ONE toast
// per import batch that tells the user to look there.
//
// Loaded only from the import chunks (importDatasets.ts, importAppendRun.ts),
// never from startup code.

import type { DataStruct } from "../lib/types";
import { toast, TOAST_ACTION_TTL } from "./toasts";

/** The parser's notes on `data`, or `[]` when it has none. */
export function parserNotes(data: Pick<DataStruct, "metadata">): string[] {
  const notes = (data.metadata as Record<string, unknown> | undefined)?.notes;
  return Array.isArray(notes) ? notes.filter((n): n is string => typeof n === "string" && n.length > 0) : [];
}

/** One toast for a whole import batch: the first file's first note plus a
 *  count of the rest. No-op when no file had notes. Same lifetime and kind as
 *  `notifyMigrationWarnings` — the data landed, but something was dropped. */
export function notifyParserNotes(files: readonly { name: string; notes: readonly string[] }[]): void {
  const noted = files.filter((f) => f.notes.length > 0);
  if (!noted.length) return;
  const total = noted.reduce((n, f) => n + f.notes.length, 0);
  const more = total > 1 ? ` (+${total - 1} more in Metadata)` : "";
  toast(`${noted[0].name}: ${noted[0].notes[0]}${more}`, "info", { ttlMs: TOAST_ACTION_TTL });
}
