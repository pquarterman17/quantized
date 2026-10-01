// IMPORT-APPEND (gap #47), extracted from store/useApp.ts (audit P4.1, the
// eleventh domain — store-size ratchet, MAIN_PLAN #2). Composed into the ONE
// useApp store like ./recalcEngine: `useApp` spreads
// `createImportAppendSlice(get)` into the store, so every
// `getState().importFilesAppended(files)` call keeps working. A code
// boundary, not a second store.
//
// WHAT THIS MODULE OWNS: `importFilesAppended` — import ≥2 files and
// concatenate them row-wise into ONE dataset, the alternative to
// importFiles' N-separate-datasets result for a same-shape multi-file series
// (e.g. a scan split across daily files). It never produces a dead import:
// an Origin multi-workbook file (`data.books`), an upload failure, a
// column-count mismatch (mergeDatasets's guard) or a declined unit/name
// review (P2.5) all degrade to `importFiles(files, { bypassGuard: true })`
// — N separate datasets — with an explanatory toast. `bypassGuard` because
// commands/fileCommands.ts's "import-append" already holds the double-import
// guard for this whole call (review finding 5).
//
// Contract: the clean path lands through `addDataset` (one "add dataset" undo
// step), pushes one recent per file, records a typed `import` macro step and
// sets status + an ok toast to the same line.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React. ./useApp
// is TYPE-only, so the runtime graph stays one-directional (useApp -> here).
// lib/transformRun stays a lazy import (bundle ratchet).
//
// Characterization tests: store/importAppend.characterization.test.ts —
// written green against the pre-extraction useApp.ts and unchanged by the
// move. useApp.test.ts's "importFilesAppended" block covers the fallback's
// N-dataset result end to end.

import { uploadFile } from "../lib/api";
import { lit } from "../lib/macro";
import type { DataStruct } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

export interface ImportAppendSlice {
  // Import ≥2 files and concatenate them row-wise into ONE dataset (gap #47) —
  // the alternative to importFiles' N-separate-datasets result, for same-shape
  // multi-file series (e.g. a scan split across daily files). Falls back to
  // importFiles (separate datasets + a toast) on a shape mismatch or an Origin
  // multi-workbook file, so it never produces a dead import.
  importFilesAppended: (files: File[]) => Promise<void>;
}

// Takes only `get`: every write goes through addDataset/setStatus/pushRecent.
export function createImportAppendSlice(get: SliceGet): ImportAppendSlice {
  return {
    importFilesAppended: async (files) => {
      if (files.length < 2) {
        toast("append needs ≥2 files — use Import data… for one", "danger");
        return;
      }
      get().setStatus(`importing ${files.length} files to append…`);
      const uploaded: { name: string; size: number; data: DataStruct }[] = [];
      let failReason = "";
      for (const file of files) {
        try {
          const data = await uploadFile(file);
          if (data.books && data.books.length > 1) {
            failReason = `${file.name} is a multi-workbook Origin project — can't append`;
            break;
          }
          uploaded.push({ name: file.name, size: file.size, data });
        } catch (e) {
          failReason = `${file.name}: ${e instanceof Error ? e.message : "error"}`;
          break;
        }
      }
      if (!failReason && uploaded.length === files.length) {
        try {
          // lazy (bundle ratchet); reviews unit/label mismatches first (P2.5) —
          // declining lands the files as separate datasets below.
          const merged = await (await import("../lib/transformRun")).reviewedAppend(
            uploaded.map((u) => u.data),
            uploaded.map((u) => u.name),
          );
          if (!merged) throw new Error("append cancelled at the unit/name review");
          const id = nextDatasetId();
          const name = `${uploaded[0].name} +${uploaded.length - 1} more (appended)`;
          get().addDataset({ id, name, data: merged });
          for (const u of uploaded) get().pushRecent(u.name, u.size);
          get().recordMacro(
            `Import (append) ${uploaded.length} files`,
            `qz.importAppended(${lit(uploaded.map((u) => u.name))})`,
            { kind: "import", params: { names: uploaded.map((u) => u.name) } },
          );
          const msg = `appended ${uploaded.length} files → ${merged.time.length} rows`;
          get().setStatus(msg);
          toast(msg, "ok");
          return;
        } catch (e) {
          failReason = e instanceof Error ? e.message : "append failed (column-count mismatch)";
        }
      }
      // Degrade to N separate datasets rather than a dead import (bypassGuard: "import-append" already holds it).
      toast(`${failReason} — importing separately instead`, failReason.startsWith("append cancelled") ? "info" : "danger");
      await get().importFiles(files, { bypassGuard: true });
    },
  };
}
