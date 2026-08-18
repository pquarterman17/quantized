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
//
// P1.1 C3: "Save workspace" now tries a NATIVE Save As first — a real dialog,
// a real path, a direct in-process write (desktopBridge.ts's `saveProjectAs`)
// — and falls back to the pre-existing `saveBlob` download exactly when
// `saveProjectAs` reports `null` ("no usable bridge", which is EVERY jsdom
// test environment and every browser tab). A `CANCELLED` result is a
// deliberate no-op: the user backed out of the native dialog, and falling
// back to a browser download they never asked for would be worse than doing
// nothing. Only a genuine native save (a real returned path) records a
// Recent Projects entry — see lib/recentProjects.ts's module doc for why a
// browser download, which has no path, never does.

import { CANCELLED, saveProjectAs } from "../lib/desktopBridge";
import { saveBlob } from "../lib/download";
import { captureTechniqueView } from "../lib/techniqueViewMemory";
import { mergeWorkspace, serializeWorkspace, type LoadedWorkspace } from "../lib/workspace";
import { useRecentProjects } from "./recentProjects";
import { toast } from "./toasts";
import { nextDatasetId, type AppState } from "./useApp";
import { nextWorkbookId } from "./workbookIds";

type SliceSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Basename of a native path, tolerant of either separator (the same "either
 *  slash, Windows paths included" handling lib/importEntry.ts's
 *  `parentDirectory` uses for the complementary half of a path). */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf(String.fromCharCode(92)));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

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
  const s = get();
  // PLOT_WORKFLOW_PLAN item 5: fold the FOCUSED window's still-live view into
  // its technique's memory slot before saving — mirrors `windowsForSave()`'s
  // "save is a sanctioned snapshot point" so unswitched-away edits aren't lost.
  const techniqueViewMemory = captureTechniqueView(
    s.datasets.find((d) => d.id === s.activeId),
    s,
    s.techniqueViewMemory,
  );
  const content = serializeWorkspace({ ...s, plotWindows: s.windowsForSave(), techniqueViewMemory });

  const native = await saveProjectAs("workspace.dwk", content);
  if (native === CANCELLED) return; // the user backed out — do nothing, never fall back
  if (native !== null) {
    useRecentProjects.getState().pushRecentProject(baseName(native.path), native.path);
    const msg = `saved workspace to ${native.path} — ${all.length} dataset${all.length === 1 ? "" : "s"}`;
    get().setStatus(msg);
    toast(msg, "ok");
    return;
  }

  // No usable bridge (every browser tab, and every jsdom test environment) —
  // byte-identical to this function's pre-P1.1 behavior.
  saveBlob(new Blob([content], { type: "application/json" }), "workspace.dwk");
  const msg = `saved workspace — ${all.length} dataset${all.length === 1 ? "" : "s"}`;
  get().setStatus(msg);
  toast(msg, "ok");
}

/** Append Project (MAIN_PLAN #16, workbook transfer LIBRARY_WORKBOOK_UX_PLAN
 *  PR A4): join a freshly-parsed .dwk's flat dataset list AND its referenced
 *  workbooks into the currently loaded library. See
 *  lib/workspaceMerge.mergeWorkspace for the full reference-field matrix of
 *  what is (and deliberately isn't) merged in. `recordHistory` runs BEFORE
 *  the mutation, and `workbooks` is already part of `HistorySnapshot`
 *  (history.ts), so undo restores the pre-append workbook list for free —
 *  same as it already does for `datasets`. */
export function runAppendWorkspace(set: SliceSet, get: SliceGet, ws: LoadedWorkspace): void {
  const n = ws.datasets.length;
  if (n === 0) {
    toast("workspace has no datasets to append", "danger");
    return;
  }
  get().recordHistory("append workspace");
  const currentWorkbookIds = new Set(get().workbooks.map((w) => w.id));
  const { datasets, renamed, workbooks } = mergeWorkspace(
    get().datasets,
    ws,
    nextDatasetId,
    currentWorkbookIds,
    nextWorkbookId,
  );
  const wbNote =
    workbooks.length > 0
      ? ` — ${workbooks.length} workbook${workbooks.length === 1 ? "" : "s"} landed at Library root`
      : "";
  const msg = `appended ${n} dataset${n === 1 ? "" : "s"} (${renamed} renamed)${wbNote}`;
  set({ datasets, workbooks: [...get().workbooks, ...workbooks], status: msg });
  toast(msg, "ok");
}
