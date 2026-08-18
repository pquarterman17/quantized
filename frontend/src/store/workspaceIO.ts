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

import { CANCELLED, hasDesktopShell, saveProjectAs, saveProjectTo } from "../lib/desktopBridge";
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

/** Shared "saved workspace [to PATH] — N dataset(s)" status/toast text —
 *  used by every successful save branch below (native Save As, quick Save,
 *  and the browser-download fallback) so the phrasing can't drift between them. */
function savedMsg(n: number, path?: string): string {
  return `saved workspace${path ? ` to ${path}` : ""} — ${n} dataset${n === 1 ? "" : "s"}`;
}

/** Resolve pending books and serialize the live workspace — the shared
 *  preface both Save (`runSaveWorkspace`) and Save As (`runSaveWorkspaceToFile`)
 *  need before they can write anything. Returns null when there is nothing to
 *  save or resolving pending books failed; both cases already set status/toast
 *  themselves, so callers just bail out. */
async function serializeCurrentWorkspace(get: SliceGet): Promise<string | null> {
  const all = get().datasets;
  if (all.length === 0) {
    get().setStatus("no datasets to save");
    return null;
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
      return null;
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
  return serializeWorkspace({ ...s, plotWindows: s.windowsForSave(), techniqueViewMemory });
}

export async function runSaveWorkspaceToFile(get: SliceGet): Promise<void> {
  const content = await serializeCurrentWorkspace(get);
  if (content === null) return;
  const all = get().datasets; // unaffected by serializing — safe to re-read for the count

  const native = await saveProjectAs("workspace.dwk", content);
  if (native === CANCELLED) return; // the user backed out — do nothing, never fall back
  if (native !== null) {
    // P1.2 box 1: a native Save As always establishes (or renames) the
    // project's identity and clears the dirty marker — this IS the moment
    // the live workspace and disk agree.
    get().setCurrentProject({ name: baseName(native.path), path: native.path });
    useRecentProjects.getState().pushRecentProject(baseName(native.path), native.path);
    const msg = savedMsg(all.length, native.path);
    get().setStatus(msg);
    toast(msg, "ok");
    return;
  }

  // No usable bridge (every browser tab, and every jsdom test environment) —
  // byte-identical to this function's pre-P1.1 behavior. A browser download
  // has no durable path, so `currentProject` is deliberately left untouched
  // (lib/recentProjects.ts's module doc has the identical rule for Recent
  // Projects entries — the same "no path, no identity" reasoning applies).
  saveBlob(new Blob([content], { type: "application/json" }), "workspace.dwk");
  const msg = savedMsg(all.length);
  get().setStatus(msg);
  toast(msg, "ok");
}

/** "Save" (Ctrl+S) — P1.2 box 1: write straight to the CURRENT project's
 *  known path with no dialog, when one is known and a bridge can reach it.
 *  Falls back to the Save As flow (`runSaveWorkspaceToFile` — native dialog,
 *  or a browser download) whenever there is no known project path yet, or no
 *  bridge to write through: identical to the pre-P1.2 "Save workspace"
 *  command's only behavior, so a browser tab is unaffected by this slice.
 *
 *  A write failure here is reported and left AS a failure — unlike Save As,
 *  which degrades to a browser download when the native write fails, a
 *  quick-save failure must never silently substitute a download the user
 *  did not ask for in place of the NAMED project they meant to update; the
 *  atomic temp-file-plus-`os.replace` write (desktop_bridge.py) already
 *  guarantees the previous good file on disk is untouched, so the only job
 *  left here is to say so plainly and leave the dirty marker set. */
export async function runSaveWorkspace(get: SliceGet): Promise<void> {
  const project = get().currentProject;
  if (project === null || !hasDesktopShell()) {
    return runSaveWorkspaceToFile(get);
  }
  const content = await serializeCurrentWorkspace(get);
  if (content === null) return;

  const result = await saveProjectTo(project.path, content);
  if (result === null) {
    const msg = `save failed — could not write to ${project.path} (try Save As)`;
    get().setStatus(msg);
    toast(msg, "danger");
    return;
  }
  get().markProjectClean();
  useRecentProjects.getState().pushRecentProject(project.name, project.path);
  const msg = savedMsg(get().datasets.length, result.path);
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
