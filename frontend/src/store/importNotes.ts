// Parser notes after an import. A parser that drops or truncates rows, or
// imports a text column as categorical, records one sentence per problem in
// `metadata.notes` (src/quantized/io/_row_width.py, io/delimited.py). The
// Metadata card shows the full text (lib/metadata.ts); this fires the ONE toast
// per import batch that tells the user to look there.
//
// Loaded only from the import chunks (importDatasets.ts, importAppendRun.ts,
// the lazy Import Wizard's useImportWizard.ts),
// never from startup code.

import { effectiveDesignations } from "../lib/columnmeta";
import { ownXSeries } from "../lib/ownXSeries";
import { plural } from "../lib/plural";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { DataStruct, Dataset } from "../lib/types";
import { toast, TOAST_ACTION_TTL } from "./toasts";

/** The parser's notes on `data`, or `[]` when it has none. */
export function parserNotes(data: Pick<DataStruct, "metadata">): string[] {
  const notes = (data.metadata as Record<string, unknown> | undefined)?.notes;
  return Array.isArray(notes) ? notes.filter((n): n is string => typeof n === "string" && n.length > 0) : [];
}

type NotedFile = { name: string; notes: readonly string[] };

/** The batch's notes in one line: the first file's first note plus a count of
 *  the rest, or "" when no file had notes. The toast below and the import
 *  status line (store/importDatasets.ts) both say exactly this, so a skipped
 *  workbook sheet ("Sheet 'Notes' has no numeric data; not imported.") is on
 *  the status bar after the toast has gone, not only in the Metadata card. */
export function parserNotesSummary(files: readonly NotedFile[]): string {
  const noted = files.filter((f) => f.notes.length > 0);
  if (!noted.length) return "";
  const total = noted.reduce((n, f) => n + f.notes.length, 0);
  const more = total > 1 ? ` (+${total - 1} more in Metadata)` : "";
  return `${noted[0].name}: ${noted[0].notes[0]}${more}`;
}

/** One toast for a whole import batch (`parserNotesSummary`). No-op when no
 *  file had notes. Same lifetime and kind as `notifyMigrationWarnings` — the
 *  data landed, but something was dropped. */
export function notifyParserNotes(files: readonly NotedFile[]): void {
  const summary = parserNotesSummary(files);
  if (summary) toast(summary, "info", { ttlMs: TOAST_ACTION_TTL });
}

/** A book whose Y columns belong to a SECONDARY X (an Origin X,Y,X,Y sheet,
 *  or a user's "Set As X") has those Ys held back from its default plot
 *  (lib/errorbars.ts's `bookDefaultHiddenChannels` -- the default plot has
 *  one X, and drawing them there would bind them to the wrong one). Say so
 *  once per import batch, with the gesture that draws every Y against its own
 *  X (Quick Plot's per-series-X seed). No-op when no imported book has any. */
export function notifyOwnXSeries(datasets: readonly Dataset[]): void {
  for (const ds of datasets) {
    const n = Object.keys(ownXSeries(effectiveDesignations(ds.data, ds.columnDesignations))).length;
    if (!n) continue;
    toast(`${ds.name}: ${n} Y column${plural(n)} belong${n === 1 ? "s" : ""} to another X column and ${n === 1 ? "is" : "are"} hidden from this plot`, "info", {
      ttlMs: TOAST_ACTION_TTL,
      action: {
        label: "Plot each Y against its own X",
        onClick: () =>
          void runLazy("Loading Quick Plot…", () => import("./quickPlotRun")).then(
            (m) => m.plotEachAgainstOwnX(ds.id),
            onLoadFailure,
          ),
      },
    });
    return;
  }
}
