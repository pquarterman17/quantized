// The body of `importFilesAppended` (store/importAppend.ts), moved here
// verbatim by bundle diet slice 16 (plans/BUNDLE_HEADROOM.md) so it loads on
// the first append instead of at startup. The slice's own module keeps the
// "fewer than two files" refusal and the progress status line, then loads
// this; see that module's header for the contract both halves keep.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React. ./useApp
// is TYPE-only. lib/transformRun stays a lazy import (bundle ratchet).

import type { uploadFile } from "../lib/api";
import { lit } from "../lib/macro";
import type { DataStruct } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import { notifyParserNotes, parserNotes, parserNotesSummary } from "./importNotes";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

export interface AppendRunOptions {
  signal?: AbortSignal;
  onProgress?: (index: number, total: number, name: string) => void;
}

/** Upload, review and land `files` (≥2) as ONE dataset, or degrade to N
 *  separate datasets with a toast. The caller has already checked the count
 *  and set the progress status. `upload` is lib/api's `uploadFile`, passed in
 *  rather than imported: a static lib/api import from this lazy chunk made
 *  Rollup split lib/api into an eager chunk of its own (measured, the same
 *  finding commands/fileCommandsLazy.ts records). */
export async function runImportFilesAppended(
  get: () => AppState,
  files: File[],
  upload: typeof uploadFile,
  opts: AppendRunOptions = {},
): Promise<void> {
  const { signal } = opts;
  // Cancel is not a failure: nothing lands and nothing degrades to N separate
  // imports (the fallback below would import every file after all).
  const cancelled = (): boolean => {
    if (!signal?.aborted) return false;
    get().setStatus("append cancelled — nothing was imported");
    toast("append cancelled — nothing was imported", "info");
    return true;
  };
  const uploaded: { name: string; size: number; data: DataStruct }[] = [];
  let failReason = "";
  for (const [i, file] of files.entries()) {
    if (cancelled()) return;
    opts.onProgress?.(i + 1, files.length, file.name);
    try {
      const data = await upload(file, signal);
      if (data.books && data.books.length > 1) {
        failReason = `${file.name} is a multi-workbook Origin project — can't append`;
        break;
      }
      if (data.sheets?.length) {
        failReason = `${file.name} has several data sheets — can't append`;
        break;
      }
      uploaded.push({ name: file.name, size: file.size, data });
    } catch (e) {
      if (cancelled()) return;
      failReason = `${file.name}: ${e instanceof Error ? e.message : "error"}`;
      break;
    }
  }
  if (cancelled()) return;
  if (!failReason && uploaded.length === files.length) {
    try {
      // lazy (bundle ratchet); reviews unit/label mismatches first (P2.5) —
      // declining lands the files as separate datasets below.
      const merged = await (await import("../lib/transformRun")).reviewedAppend(
        uploaded.map((u) => u.data),
        uploaded.map((u) => u.name),
      );
      // The review dialog is the last await before the store write: re-check
      // the abort here so a Cancel pressed meanwhile lands nothing (and does
      // not fall through to the separate-import degrade below).
      if (cancelled()) return;
      if (!merged) throw new Error("append cancelled at the unit/name review");
      const id = nextDatasetId();
      const name = `${uploaded[0].name} +${uploaded.length - 1} more (appended)`;
      get().addDataset({ id, name, data: merged });
      // Already active; `setActive` also drops a worksheet-only override, so the
      // Worksheet tab shows the appended data, not a book opened earlier.
      get().setActive(id);
      for (const u of uploaded) get().pushRecent(u.name, u.size);
      get().recordMacro(
        `Import (append) ${uploaded.length} files`,
        `qz.importAppended(${lit(uploaded.map((u) => u.name))})`,
        { kind: "import", params: { names: uploaded.map((u) => u.name) } },
      );
      const msg = `appended ${uploaded.length} files → ${merged.time.length} rows`;
      const noted = uploaded.map((u) => ({ name: u.name, notes: parserNotes(u.data) }));
      const notes = parserNotesSummary(noted); // on the status line too (importNotes.ts)
      get().setStatus(notes ? `${msg} — ${notes}` : msg);
      toast(msg, "ok");
      notifyParserNotes(noted);
      return;
    } catch (e) {
      failReason = e instanceof Error ? e.message : "append failed (column-count mismatch)";
    }
  }
  // Degrade to N separate datasets rather than a dead import (bypassGuard: "import-append" already holds it).
  toast(`${failReason} — importing separately instead`, failReason.startsWith("append cancelled") ? "info" : "danger");
  await get().importFiles(files, { bypassGuard: true });
}
