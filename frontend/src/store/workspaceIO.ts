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
// a real path, a direct in-process write (desktopBridge.ts's
// `pickSaveDestination` + `saveProjectTo` — split from the original combined
// `saveProjectAs` under P2's adversarial-review fix, below, so a lock check
// can sit between the dialog and the write) — and falls back to the
// pre-existing `saveBlob` download exactly when there is no usable bridge OR
// the write itself failed after a real pick ("no usable bridge" is EVERY
// jsdom test environment and every browser tab). A `CANCELLED` result is a
// deliberate no-op: the user backed out of the native dialog, and falling
// back to a browser download they never asked for would be worse than doing
// nothing. Only a genuine native save (a real returned path) records a
// Recent Projects entry — see lib/recentProjects.ts's module doc for why a
// browser download, which has no path, never does.

import { CANCELLED, hasDesktopShell, pickSaveDestination, saveProjectTo, type SaveProjectResult } from "../lib/desktopBridge";
import { saveBlob } from "../lib/download";
import { classifyLock, verifyBeforeWrite } from "../lib/lockState";
import { captureTechniqueView } from "../lib/techniqueViewMemory";
import { mergeWorkspace, serializeWorkspace, type LoadedWorkspace } from "../lib/workspace";
import { useProjectLock } from "./projectLock";
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

  // P1.1 C3 + P2 (adversarial review, 2026-08-19): the dialog pick and the
  // actual write are now two separate calls (desktopBridge.ts's
  // `pickSaveDestination` + `saveProjectTo`, replacing the combined
  // `saveProjectAs`) specifically so a lock check can sit BETWEEN them — "a
  // fresh native dialog is a deliberate destination pick" is not
  // automatically a SAFE one: nothing previously stopped a read-only
  // session from Save-As-ing back onto the very path another LIVE instance
  // holds the write lock for and silently overwriting it.
  const destination = await pickSaveDestination("workspace.dwk");
  if (destination === CANCELLED) return; // the user backed out — do nothing, never fall back
  let native: SaveProjectResult | null = null;
  if (destination !== null) {
    // Only a LIVE other holder refuses — a stale one, or no lock tracked at
    // all, proceeds exactly as before (this can only ever make a write MORE
    // cautious, never invent a refusal the lock state itself doesn't
    // support; matches runSaveWorkspace's identical "gate can only ever make
    // a write more cautious" rule).
    const lock = useProjectLock.getState();
    if (lock.path === destination) {
      const current = await lock.provider.read(destination).catch(() => null);
      const status = classifyLock(current, lock.instanceId, Date.now());
      if (status === "held-by-other-live") {
        useProjectLock.setState({ status, record: current });
        const msg = `save refused — "${baseName(destination)}" is open for editing in another instance`;
        get().setStatus(msg);
        toast(msg, "danger");
        return; // a deliberate refusal, not a failure — no download fallback either
      }
    }
    native = await saveProjectTo(destination, content);
  }
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

  // No usable bridge (every browser tab, and every jsdom test environment),
  // OR the write itself failed after a real pick — byte-identical to this
  // function's pre-P1.1/pre-P2 behavior. A browser download has no durable
  // path, so `currentProject` is deliberately left untouched
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
  // PR I2 (L0.47): quick-save is the ONE write that lands on a KNOWN path
  // with no fresh dialog — the exact write "never permit silent concurrent
  // writes to one project" guards. This first check is a CHEAP, CACHED
  // pre-check against `useProjectLock`'s last-known status for THIS exact
  // path — it exists to fail fast (skip resolving pending books / serializing
  // for nothing) on the common, UI-visible read-only case, but it is NOT the
  // actual safety guarantee: the cache is only refreshed by the ~30s
  // heartbeat tick (store/projectLock.ts's `heartbeat`), so it can be stale.
  // See the FRESH re-verification right before `saveProjectTo` below for what
  // actually enforces this. Any OTHER lock-tracked path, or no lock tracked
  // at all (the booked-defer in-memory provider's honest default — see
  // store/projectLock.ts's header), is left alone: this gate can only ever
  // make a write MORE cautious, never invent a refusal the lock state itself
  // doesn't support.
  const cachedLock = useProjectLock.getState();
  if (cachedLock.path === project.path && !cachedLock.canWriteNow()) {
    const msg =
      cachedLock.status === "held-by-other-stale"
        ? `read-only — another (unresponsive) instance has this project open; use Take Over Editing`
        : `read-only — another instance has this project open for editing`;
    get().setStatus(msg);
    toast(msg, "danger");
    return;
  }
  const content = await serializeCurrentWorkspace(get);
  if (content === null) return;

  // P1 (adversarial review, 2026-08-19): THE actual enforcement point — a
  // fresh read straight from the lock provider, taken immediately before the
  // write itself, not the cached status above. This is what makes
  // `lib/lockState.ts`'s `verifyBeforeWrite` doc ("the resumed original's
  // very next write attempt is refused") true for a REAL write path, not
  // only for the periodic heartbeat tick. Re-reads `useProjectLock.getState()`
  // fresh (not the `cachedLock` captured above) in case a takeover happened
  // via the UI while `serializeCurrentWorkspace` was running. Save As is
  // still deliberately left ungated here — a fresh native dialog is always a
  // new, deliberate destination pick; see P2's separate destination-overwrite
  // guard on that path instead.
  const lock = useProjectLock.getState();
  if (lock.path === project.path) {
    const current = await lock.provider.read(project.path).catch(() => null);
    if (!verifyBeforeWrite(current, lock.instanceId)) {
      useProjectLock.setState({ status: classifyLock(current, lock.instanceId, Date.now()), record: current });
      const msg = "save refused — another instance now holds this project's lock";
      get().setStatus(msg);
      toast(msg, "danger");
      return;
    }
  }

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
