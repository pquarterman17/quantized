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

import {
  CANCELLED,
  LOCK_LOST,
  hasDesktopShell,
  pickSaveDestination,
  saveProjectTo,
  type SaveProjectResult,
} from "../lib/desktopBridge";
import { saveBlob } from "../lib/download";
import { canRelease, classifyLock, type LockRecord, type LockStatus } from "../lib/lockState";
import { captureTechniqueView } from "../lib/techniqueViewMemory";
import { mergeWorkspace, serializeWorkspace, type LoadedWorkspace } from "../lib/workspace";
import { statusFromRefusal, useProjectLock, type LockProvider } from "./projectLock";
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

/** I2 (P0-3/P1-1): acquire the lock for a Save-As DESTINATION before ever
 *  writing to it — a single read+classify+CAS-acquire sequence against the
 *  LIVE `useProjectLock` provider, but deliberately WITHOUT touching the
 *  store's live `path`/`status`/`record` until the write itself has
 *  actually succeeded (`runSaveWorkspaceToFile` below does that transfer).
 *  Pointing `useProjectLock.path` at the new destination before a write
 *  that might still fail would desync it from `useApp.currentProject` —
 *  the exact P3 bug `lib/openWorkspaceReplace.ts`'s `reserveLockForSwitch`
 *  exists to avoid, applied here to the Save-As path too.
 *
 *  A LIVE other holder refuses outright. A STALE one is taken over
 *  DIRECTLY, with no "Take Over Editing" UI gate — Save As has always been
 *  allowed to proceed over a merely-stale destination (the pre-existing P2
 *  ruling this preserves: a fresh, deliberately-dialog-picked destination
 *  is not the silent background write L0.47's explicit-takeover gate
 *  exists to prevent). */
async function acquireDestinationLock(
  provider: LockProvider,
  instanceId: string,
  destination: string,
): Promise<{ ok: true; record: LockRecord } | { ok: false; status: LockStatus }> {
  const now = Date.now();
  let current: LockRecord | null;
  try {
    current = await provider.read(destination);
  } catch {
    return { ok: false, status: "held-by-other-live" };
  }
  const status = classifyLock(current, instanceId, now);
  if (status === "held-by-other-live") return { ok: false, status };
  try {
    const result =
      status === "held-by-other-stale"
        ? await provider.takeOver(destination, current?.token ?? "")
        : await provider.tryAcquire(destination);
    if (!result.acquired || result.record === null) {
      // R4/F4: reuse `store/projectLock.ts`'s own `statusFromRefusal`
      // rather than re-deriving this inline — a CAS refusal whose provider
      // could not verify anything (no bridge / a thrown call / a malformed
      // response / a `contended` OS-lock busy signal) still reports
      // `record: null`, and `classifyLock(null, ...)` alone would
      // misreport that as `"unlocked"`. An inline re-derivation had
      // drifted to check only `unverifiable` and silently ignore
      // `contended` (F4, code review follow-up); a single shared function
      // is what keeps every CAS-refusal call site honest going forward.
      return { ok: false, status: statusFromRefusal(result, instanceId, Date.now()) };
    }
    return { ok: true, record: result.record };
  } catch {
    return { ok: false, status: "held-by-other-live" };
  }
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
  if (typeof destination === "object" && destination !== null) {
    // The dialog itself refused the pick and said why (P1.2 box 4: the
    // destination is the open project's own declared raw source — see
    // desktop_bridge_dialogs.py's `save_file_dialog`). A refusal, not a
    // cancel: say so, and never fall back to a download either.
    const msg = `save refused — ${destination.refused}`;
    get().setStatus(msg);
    toast(msg, "danger");
    return;
  }
  let native: SaveProjectResult | null = null;
  if (destination !== null) {
    // P1.2 box 4: a fast, friendly PRE-check — the desktop bridge itself
    // (desktop_bridge.py's `write_project_file`/`save_file_dialog`, backed
    // by `desktop_consent.is_declared_source`) is what actually enforces
    // this (exact realpath equality, server-side), so this is belt only,
    // never the buckle: it just turns "silently refused two calls later"
    // into an immediate, specific status naming the dataset, without a
    // round trip through the dialog/lock machinery first. Exact string
    // equality only — the backend's realpath resolution is the source of
    // truth for anything a case-insensitive filesystem might otherwise
    // disagree about.
    const sourceDataset = get().datasets.find((d) => d.source?.path === destination);
    if (sourceDataset) {
      const msg = `save refused — "${baseName(destination)}" is the data source of "${sourceDataset.name}"`;
      get().setStatus(msg);
      toast(msg, "danger");
      return; // never write, never fall back to a browser download
    }
    // I2 (P0-3/P1-1): ACQUIRE the destination's lock first — see
    // `acquireDestinationLock`'s own doc. This replaces the old
    // "only check IF the lock happens to already be tracking this exact
    // path" gate with a real acquisition attempt against ANY destination,
    // whether or not this session ever opened it before.
    const lock = useProjectLock.getState();
    const acquired = await acquireDestinationLock(lock.provider, lock.instanceId, destination);
    if (!acquired.ok) {
      const msg =
        acquired.status === "held-by-other-live"
          ? `save refused — "${baseName(destination)}" is open for editing in another instance`
          : `save refused — "${baseName(destination)}" is currently locked by another instance`;
      get().setStatus(msg);
      toast(msg, "danger");
      return; // a deliberate refusal, not a failure — no download fallback either
    }
    const write = await saveProjectTo(destination, content, acquired.record.token);
    if (write !== null && write !== LOCK_LOST) {
      native = write;
      // Success: release the OLD lock — a DIFFERENT path this instance
      // actually held — now that the NEW path is the project's identity.
      // Never strand the prior lock; mirrors
      // lib/openWorkspaceReplace.ts's identical "switching releases the
      // old" rule for the ordinary open path.
      if (lock.path !== null && lock.path !== destination && canRelease(lock.record, lock.instanceId)) {
        await lock.provider.release(lock.path, lock.record?.token ?? "").catch(() => false);
      }
      useProjectLock.setState({
        status: "held-by-me",
        record: acquired.record,
        path: destination,
        openedAsCopy: false,
        // F2 (code review round 3): the THIRD fresh-acquisition site (with
        // openProject/takeOverEditing in store/projectLock.ts) that must
        // reset the streak — a carried-over count from the OLD project
        // must never demote this brand-new lock after one more blip.
        unverifiableHeartbeats: 0,
        instanceId: acquired.record.instanceId,
      });
    } else {
      // Write failed (or a razor-thin race lost the lock right after this
      // instance acquired it) — release the JUST-acquired new lock and
      // leave the OLD lock completely untouched: the user is still
      // working in the prior project, this Save As simply didn't happen.
      await lock.provider.release(destination, acquired.record.token ?? "").catch(() => false);
    }
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

  // I2 (P0-3/P1-1): THE actual enforcement point — the CURRENTLY held
  // token (re-reads `useProjectLock.getState()` fresh, not the `cachedLock`
  // captured above, in case a takeover happened via the UI while
  // `serializeCurrentWorkspace` was running) travels straight into the
  // write call. `write_project_file`'s own exclusive-OS-lock CAS is what
  // actually verifies it, IMMEDIATELY before the write, in the SAME
  // round-trip as the write itself — closing the save TOCTOU a separate
  // frontend "read, then write" could never truly close across processes
  // (there is always a gap between two round-trips; there is none within
  // one). No token to hold (the lock system hasn't opined on this exact
  // path) means an empty string, which skips the backend check entirely —
  // this can only ever make a write MORE cautious, never invent a refusal
  // the lock state itself doesn't support. Save As is still deliberately
  // left ungated here — a fresh native dialog is always a new, deliberate
  // destination pick; see `acquireDestinationLock` on that path instead.
  const lock = useProjectLock.getState();
  const token = lock.path === project.path ? (lock.record?.token ?? "") : "";
  const result = await saveProjectTo(project.path, content, token);
  if (result === LOCK_LOST) {
    // Drop to read-only honestly (a fresh read reports who, if anyone,
    // holds it now) and STOP — no retry loop, and specifically no fallback
    // to a browser download, which would silently create a second,
    // divergent copy of the user's edits instead of surfacing the loss.
    //
    // R4: LOCK_LOST already proves — via the write's own rejection, not
    // this read — that this instance no longer owns the lock. A `null`
    // from the read below can mean EITHER "verified: nothing holds it now"
    // OR "the provider itself couldn't be asked", and `read()`'s bare
    // `LockRecord | null` contract can't tell those apart. Never re-derive
    // `classifyLock(null, ...)`'s `"unlocked"` from that ambiguity — it
    // would read as "free to reacquire", the exact misleading-editable
    // impression this fix exists to prevent. Fail closed to the same
    // read-only placeholder every other refusal in this module uses
    // instead; a populated record (someone else's) still classifies
    // normally, since that IS verified information.
    const current = await lock.provider.read(project.path).catch(() => null);
    const status = current === null ? "held-by-other-live" : classifyLock(current, lock.instanceId, Date.now());
    useProjectLock.setState({ status, record: current, unverifiableHeartbeats: 0 });
    const msg = "save refused — the project lock was lost (another instance may hold it now)";
    get().setStatus(msg);
    toast(msg, "danger");
    return;
  }
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
