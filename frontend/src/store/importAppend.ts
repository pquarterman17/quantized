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
import { toast } from "./toasts";
import type { AppendRunOptions } from "./importAppendRun";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

export interface ImportAppendSlice {
  // Import ≥2 files and concatenate them row-wise into ONE dataset (gap #47) —
  // the alternative to importFiles' N-separate-datasets result, for same-shape
  // multi-file series (e.g. a scan split across daily files). Falls back to
  // importFiles (separate datasets + a toast) on a shape mismatch or an Origin
  // multi-workbook file, so it never produces a dead import.
  //
  // `opts.signal` cancels: nothing lands and nothing degrades to separate
  // imports (a cancel is not a failure); `opts.onProgress(i, total, name)`
  // fires before each upload, i being the 1-based file about to upload.
  importFilesAppended: (files: File[], opts?: AppendRunOptions) => Promise<void>;
}

// Takes only `get`: every write goes through addDataset/setStatus/pushRecent.
// The upload/merge body, store/importAppendRun.ts, loads on the first append
// (bundle diet slice 16). A body that will not load keeps this action's
// contract: the files land as separate datasets with a danger toast, like
// every other degrade. A failed load is not cached, so the next append
// retries it.
export function createImportAppendSlice(get: SliceGet): ImportAppendSlice {
  return {
    importFilesAppended: async (files, opts) => {
      if (files.length < 2) {
        toast("append needs ≥2 files — use Import data… for one", "danger");
        return;
      }
      get().setStatus(`importing ${files.length} files to append…`);
      let body: typeof import("./importAppendRun");
      try {
        body = await import("./importAppendRun");
      } catch (e) {
        toast(`append import failed to load: ${e instanceof Error ? e.message : "error"} — importing separately instead`, "danger");
        await get().importFiles(files, { bypassGuard: true });
        return;
      }
      await body.runImportFilesAppended(get, files, uploadFile, opts);
    },
  };
}

/** The native-dialog twin of `importFilesAppended`: append the picked PATHS
 *  into one dataset (same body, same cancel and degrade rules). A function
 *  rather than a store action, so the composed store's size pins are unchanged. */
export async function importPathsAppended(get: SliceGet, paths: string[], opts?: AppendRunOptions): Promise<void> {
  if (paths.length < 2) {
    toast("append needs ≥2 files — use Import data… for one", "danger");
    return;
  }
  get().setStatus(`importing ${paths.length} files to append…`);
  let body: typeof import("./importAppendRun");
  try {
    body = await import("./importAppendRun");
  } catch (e) {
    toast(`append import failed to load: ${e instanceof Error ? e.message : "error"} — importing separately instead`, "danger");
    await get().importPaths(paths, { bypassGuard: true });
    return;
  }
  await body.runImportPathsAppended(get, paths, opts);
}
