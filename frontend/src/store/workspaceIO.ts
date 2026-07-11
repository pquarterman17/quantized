// Save-workspace-to-file (.dwk export) — extracted from store/useApp.ts
// (MAIN_PLAN #16, Append workspace) under the store-size ratchet
// (architecture.test.ts's STORE_PINS): a few lines were needed for the new
// `appendWorkspace` action, and this already-cohesive #38 "save" chunk was
// the smallest self-contained piece available to offset them. Same get-only
// DI as windows.ts/history.ts's `SliceSet`/`SliceGet` — only a TYPE import
// crosses back into useApp.ts, so there's no runtime import cycle.
//
// A .dwk must be self-contained (#38): resolve every pending lazy book
// FIRST — an exported file never references a book by a path/token that may
// not exist on another machine or after a server restart.

import { saveBlob } from "../lib/download";
import { serializeWorkspace } from "../lib/workspace";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

export async function runSaveWorkspaceToFile(get: SliceGet): Promise<void> {
  const all = get().datasets;
  if (all.length === 0) {
    get().setStatus("no datasets to save");
    return;
  }
  const pendingCount = all.filter((d) => d.pending).length;
  if (pendingCount > 0) {
    get().setStatus(`fetching ${pendingCount} book${pendingCount === 1 ? "" : "s"} before saving…`);
    try {
      await get().resolvePendingDatasets();
    } catch (e) {
      const msg = `save failed — couldn't load full data for every book: ${e instanceof Error ? e.message : "error"}`;
      get().setStatus(msg);
      toast(msg, "danger");
      return;
    }
  }
  saveBlob(
    new Blob([serializeWorkspace({ ...get(), plotWindows: get().windowsForSave() })], {
      type: "application/json",
    }),
    "workspace.dwk",
  );
  const msg = `saved workspace — ${all.length} dataset${all.length === 1 ? "" : "s"}`;
  get().setStatus(msg);
  toast(msg, "ok");
}
