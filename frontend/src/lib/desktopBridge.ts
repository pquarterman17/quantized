// Typed access to the pywebview desktop bridge (MAIN_PLAN #31; P1.1 extends
// it into the shell-agnostic project-file contract, below).
//
// `qz --desktop` injects a Python object at `window.pywebview.api` (see
// quantized/desktop_bridge.py). When it is there, an import can go through a
// NATIVE dialog and carry a real path, so the dataset gets a `source.path` and
// re-import needs no second picker. When it is not — any browser tab — every
// call here reports "unavailable" and callers fall back to the file picker.
//
// That asymmetry is deliberate and must stay VISIBLE. A browser genuinely
// cannot know a path, and quietly pretending otherwise is the "false promise
// that a path was retained" the plan warns against, so `desktopCapabilities()`
// is a real probe rather than an assumption: the bridge object can exist while
// its window is not attached yet, in which case it truthfully reports that it
// cannot pick files.
//
// -- P1.1 C1: the shell-agnostic contract --------------------------------
//
// `openFiles` / `openProject` / `saveProjectAs` / `saveProjectTo` / `probe`
// below are the surface every file COMMAND (fileCommands.ts, workspaceIO.ts)
// is meant to consume going forward — named apart from the shell that backs
// them today (pywebview) so a future Tauri implementation can drop in behind
// the SAME five names without any command-layer change. `pickNativeFiles` /
// `pickNativeDirectory` / `desktopCapabilities` / `pathState` above stay
// exactly as they were (existing callers — importEntry.ts, reopenRecent.ts —
// are untouched by this slice); `openFiles`/`probe` are now their thin
// contract-named wrappers, kept as separate exports rather than renames so
// nothing existing has to change its import.
//
// The semantics are IDENTICAL across every one of these calls, and this is
// the one rule that must never drift: `null` means "no usable bridge — the
// caller falls back to the browser input/download", a well-formed EMPTY/
// CANCELLED result means "the user backed out of the dialog — do nothing,
// and specifically do NOT fall back". Conflating the two would either lose
// the fallback entirely (browser tabs get no dialog) or — the worse
// direction — pop a SECOND dialog in the user's face right after they
// deliberately closed the first one. `pickNativeFiles`'s own doc comment
// found this the hard way for imports; every function below repeats the
// same distinction for projects.

export interface DesktopCapabilities {
  available: boolean;
  /** "pywebview" is the only shell actually wired today. "tauri" and
   *  "browser" are typed now (P1.1 C1) so the contract's callers don't need
   *  a signature change when the Tauri backend lands in its own PR — they
   *  simply start seeing a different (still-valid) value here. */
  shell: DesktopShellKind | null;
  canPickFiles: boolean;
  canPickDirectory: boolean;
  cwd: string | null;
  home: string | null;
}

export type DesktopShellKind = "pywebview" | "tauri" | "browser";

export const NO_DESKTOP: DesktopCapabilities = {
  available: false,
  shell: null,
  canPickFiles: false,
  canPickDirectory: false,
  cwd: null,
  home: null,
};

/** A file's current reachability. `offline` is NOT `missing`: an unreachable
 *  network root means "cannot tell, probably fine", and only `missing` justifies
 *  telling the user their source is gone. */
export type PathState = "ok" | "missing" | "offline" | "invalid" | "unknown";

/** Returned by every single-RESULT native call below (never the list-
 *  returning `openFiles`, which keeps using `[]`) when the user cancels the
 *  dialog. A plain string rather than a Symbol/class so it survives a
 *  structured-clone or JSON round trip unchanged if one is ever added on
 *  this boundary — equality (`=== CANCELLED`) is all any caller needs. */
export const CANCELLED = "qz/desktop-bridge/cancelled" as const;
export type Cancelled = typeof CANCELLED;

/** I2 (P0-3/P1-1): `saveProjectTo`'s distinct outcome when a supplied lock
 *  token was refused by `desktop_bridge.py`'s `write_project_file` (the
 *  save-TOCTOU fix — see that method's doc). Distinct from `null` ("no
 *  bridge, or a generic write failure") because the caller's response must
 *  differ: a lock loss means "someone else may hold this now — drop to
 *  read-only, do not retry, do not fall back to a browser download that
 *  would silently create a SECOND copy of the user's edits". */
export const LOCK_LOST = "qz/desktop-bridge/lock-lost" as const;
export type LockLost = typeof LOCK_LOST;

export interface OpenProjectResult {
  path: string;
  content: string;
}

export interface SaveProjectResult {
  path: string;
}

interface PyWebviewApi {
  probe?: () => Promise<Record<string, unknown>>;
  pick_files?: (directory?: string, multiple?: boolean) => Promise<Record<string, unknown>>;
  pick_directory?: (directory?: string) => Promise<Record<string, unknown>>;
  pick_relink_directory?: (directory?: string) => Promise<Record<string, unknown>>;
  revoke_relink_dir?: () => Promise<Record<string, unknown>>;
  path_status?: (path: string) => Promise<Record<string, unknown>>;
  save_file_dialog?: (suggestedName?: string) => Promise<Record<string, unknown>>;
  write_project_file?: (path: string, content: string, lockToken?: string) => Promise<Record<string, unknown>>;
  open_project_file?: (directory?: string) => Promise<Record<string, unknown>>;
  read_project_file?: (path: string) => Promise<Record<string, unknown>>;
  probe_source?: (path: string) => Promise<Record<string, unknown>>;
  grant_source_paths?: (paths: string[]) => Promise<Record<string, unknown>>;
  project_lock_acquire?: (path: string) => Promise<Record<string, unknown>>;
  project_lock_read?: (path: string) => Promise<Record<string, unknown>>;
  project_lock_refresh?: (path: string, token: string) => Promise<Record<string, unknown>>;
  project_lock_takeover?: (path: string, expectedToken: string) => Promise<Record<string, unknown>>;
  project_lock_release?: (path: string, token: string) => Promise<Record<string, unknown>>;
}

/** Exported (alongside `str`/`bool`/`num` below) so `lib/desktopLockBridge.ts`
 *  — the PR I2 lock wire calls, split out once this file neared the repo's
 *  general 500-line `.ts` ceiling (architecture.test.ts's RSM_CUTS_PLAN #20
 *  guard) — can reach the SAME `window.pywebview.api` accessor and
 *  type-narrowing helpers instead of duplicating them. */
export function api(): PyWebviewApi | null {
  const w = globalThis as { pywebview?: { api?: PyWebviewApi } };
  return w.pywebview?.api ?? null;
}

/** Is the desktop shell present at all? Cheap and synchronous — for deciding
 *  whether to even attempt a native call. Capability still needs `probe`. */
export function hasDesktopShell(): boolean {
  return api() !== null;
}

export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
export const bool = (v: unknown): boolean => v === true;
const shellKind = (v: unknown): DesktopShellKind | null =>
  v === "pywebview" || v === "tauri" || v === "browser" ? v : null;

/** Ask the shell what it can actually do. Never throws — a bridge that errors
 *  is reported as unavailable, because a broken bridge and no bridge should
 *  lead the caller to the same fallback. */
export async function desktopCapabilities(): Promise<DesktopCapabilities> {
  const bridge = api();
  if (!bridge?.probe) return NO_DESKTOP;
  try {
    const p = await bridge.probe();
    return {
      available: true,
      shell: shellKind(p.shell),
      canPickFiles: bool(p.canPickFiles),
      canPickDirectory: bool(p.canPickDirectory),
      cwd: str(p.cwd),
      home: str(p.home),
    };
  } catch {
    return NO_DESKTOP;
  }
}

/** P1.1 C1: the contract-named alias of `desktopCapabilities`. Identical
 *  behavior, kept as a thin wrapper (not a rename) so existing callers of
 *  `desktopCapabilities` are untouched. */
export const probe = desktopCapabilities;

export interface OpenFilesOptions {
  directory?: string;
  multiple?: boolean;
}

/** P1.1 C1: the contract-named "pick files" call. Returns absolute paths the
 *  backend has already consented to read, or `null` when there is no usable
 *  bridge — `null` means "fall back to the picker", which is DIFFERENT from
 *  `[]` ("the user cancelled"), and conflating the two would re-open the
 *  browser picker every time someone backed out of the native one. */
export async function openFiles(opts: OpenFilesOptions = {}): Promise<string[] | null> {
  const bridge = api();
  if (!bridge?.pick_files) return null;
  try {
    const out = await bridge.pick_files(opts.directory ?? "", opts.multiple ?? true);
    const paths = out.paths;
    if (!Array.isArray(paths)) return null;
    return paths.filter((p): p is string => typeof p === "string");
  } catch {
    return null;
  }
}

/** Same call as `openFiles({ directory, multiple: true })` — kept as its own
 *  export (rather than folded away) so `importEntry.ts`/its tests need no
 *  change for this slice. */
export async function pickNativeFiles(directory?: string): Promise<string[] | null> {
  return openFiles({ directory, multiple: true });
}

/** Native folder dialog — the working-directory selector. `null` = no bridge or
 *  cancelled; a directory grants no read access on its own. */
export async function pickNativeDirectory(directory?: string): Promise<string | null> {
  const bridge = api();
  if (!bridge?.pick_directory) return null;
  try {
    return str((await bridge.pick_directory(directory ?? "")).path);
  } catch {
    return null;
  }
}

/** Reachability of a stored path. `unknown` when there is no bridge to ask —
 *  the honest answer in a browser, and specifically NOT `missing`, so nothing
 *  downstream can offer to clean up a source it never actually checked. */
export async function pathState(path: string): Promise<PathState> {
  const bridge = api();
  if (!bridge?.path_status) return "unknown";
  try {
    const state = str((await bridge.path_status(path)).state);
    return state === "ok" || state === "missing" || state === "offline" || state === "invalid"
      ? state
      : "unknown";
  } catch {
    return "unknown";
  }
}

// -- P1.1 C1/C3: native project open/save ------------------------------

/** Native "open project" dialog plus an in-process read of the chosen file
 *  (quantized/desktop_bridge.py's `open_project_file` — kept off HTTP
 *  entirely, see that module's doc). `null` = no usable bridge (fall back to
 *  the browser `<input>` picker); `CANCELLED` = the user backed out of the
 *  dialog, including a well-formed backend error (no window attached, a
 *  directory instead of a file) — those degrade to "nothing happened" the
 *  same way a picker cancel does, NOT to the browser fallback, matching
 *  `openFiles`' identical error-vs-missing-bridge split. A path chosen but
 *  unreadable (a genuine read failure after a real pick) reports `null`
 *  instead: the browser picker can still open that same file from disk even
 *  when the backend's own read failed, so falling back there is strictly
 *  more useful than leaving the user stuck. */
export async function openProject(
  directory?: string,
): Promise<OpenProjectResult | Cancelled | null> {
  const bridge = api();
  if (!bridge?.open_project_file) return null;
  try {
    const out = await bridge.open_project_file(directory ?? "");
    const path = str(out.path);
    if (path === null) return CANCELLED;
    const content = str(out.content);
    if (content === null) return null;
    return { path, content };
  } catch {
    return null;
  }
}

/** Re-read a project path already covered by an earlier open/save grant this
 *  session (quantized/desktop_bridge.py's `read_project_file`) — no dialog.
 *  For reopening a Recent Projects entry. `null` covers both "no bridge" and
 *  "the grant lapsed / the read failed"; there is no dialog here to cancel,
 *  so unlike `openProject` there is no `CANCELLED` outcome. Callers that want
 *  the offline-vs-missing distinction before attempting this should check
 *  `pathState` first, same as `reopenRecent.ts` does for datasets. */
export async function readProject(path: string): Promise<OpenProjectResult | null> {
  const bridge = api();
  if (!bridge?.read_project_file) return null;
  try {
    const out = await bridge.read_project_file(path);
    const resolved = str(out.path);
    const content = str(out.content);
    if (resolved === null || content === null) return null;
    return { path: resolved, content };
  } catch {
    return null;
  }
}

/** Native "Save As" dialog ONLY — no write. Split out of `saveProjectAs`
 *  below (P2, adversarial review) for a caller that must insert a check
 *  BETWEEN the destination pick and the actual write — "a fresh native
 *  dialog is a deliberate destination pick" is not automatically a SAFE
 *  one (store/workspaceIO.ts's `runSaveWorkspaceToFile` uses this to refuse
 *  overwriting a path another LIVE instance holds the project lock for,
 *  before ever calling `saveProjectTo`). Same null/`CANCELLED` semantics as
 *  every other dialog method here: `null` = no usable bridge, `CANCELLED` =
 *  the user backed out. Requires BOTH `save_file_dialog` AND
 *  `write_project_file` to exist — the latter is what the caller will use
 *  next — so a caller is never handed a destination it then has no bridge
 *  method to write to. */
export async function pickSaveDestination(suggestedName: string): Promise<string | Cancelled | null> {
  const bridge = api();
  if (!bridge?.save_file_dialog || !bridge.write_project_file) return null;
  try {
    const dialogOut = await bridge.save_file_dialog(suggestedName);
    return str(dialogOut.path) ?? CANCELLED;
  } catch {
    return null;
  }
}

/** Native "Save As" dialog, then an in-process write of `contents` to the
 *  chosen path (quantized/desktop_bridge.py's `save_file_dialog` +
 *  `write_project_file`). `null` = no usable bridge OR the write itself
 *  failed after a real pick (fall back to the browser download — the
 *  content is not lost, just not landed at a native path); `CANCELLED` = the
 *  user backed out of the save dialog — do nothing, never fall back to a
 *  download the user did not ask for. A plain "dialog then write" combo for
 *  a caller with no reason to check anything between the two steps; a
 *  caller that DOES (store/workspaceIO.ts's lock-aware Save As) uses
 *  `pickSaveDestination` + `saveProjectTo` instead. */
export async function saveProjectAs(
  suggestedName: string,
  contents: string,
): Promise<SaveProjectResult | Cancelled | null> {
  const bridge = api();
  if (!bridge?.save_file_dialog || !bridge.write_project_file) return null;
  try {
    const dialogOut = await bridge.save_file_dialog(suggestedName);
    const path = str(dialogOut.path);
    if (path === null) return CANCELLED;
    const writeOut = await bridge.write_project_file(path, contents);
    if (!bool(writeOut.ok)) return null;
    return { path: str(writeOut.path) ?? path };
  } catch {
    return null;
  }
}

/** Write `contents` directly to an already-known project `path` — no dialog.
 *  `null` covers both "no bridge" and "the write failed / the path was
 *  never consented" — there is no dialog here to cancel, so no `CANCELLED`
 *  outcome. `lockToken`, when supplied, is forwarded to
 *  `write_project_file`'s I2 lock-token binding (P0-3/P1-1): the backend
 *  verifies it under the SAME exclusive-OS-lock CAS every other lock
 *  mutation uses, immediately before the write, and this resolves
 *  `LOCK_LOST` (never `null`) when it was refused — see that constant's
 *  doc for why the two must stay distinguishable to the caller. Omitting
 *  `lockToken` (or passing `""`) skips the check entirely, byte-identical
 *  to this function's pre-I2 behavior. */
export async function saveProjectTo(
  path: string,
  contents: string,
  lockToken?: string,
): Promise<SaveProjectResult | LockLost | null> {
  const bridge = api();
  if (!bridge?.write_project_file) return null;
  try {
    const out = await bridge.write_project_file(path, contents, lockToken ?? "");
    if (str(out.error) === "lock lost") return LOCK_LOST;
    if (!bool(out.ok)) return null;
    return { path: str(out.path) ?? path };
  } catch {
    return null;
  }
}

// -- P1.7: source probing + relink --------------------------------------

/** A source path's reachability + optional fingerprint
 *  (quantized/desktop_bridge.py's `probe_source` — see that module's doc
 *  for the full missing/offline/changed/permission-denied consent story).
 *  `checksum` is `null` whenever the backend didn't compute one — either
 *  because the path wasn't read-consented this session, or the file was
 *  reachable by stat but not by content read — never a stand-in for "the
 *  checksum is empty". */
export interface SourceProbe {
  state: PathState | "permission_denied";
  path: string | null;
  size: number | null;
  mtime: number | null;
  checksum: string | null;
}

const SOURCE_PROBE_STATES: readonly SourceProbe["state"][] = [
  "ok",
  "missing",
  "offline",
  "invalid",
  "permission_denied",
];

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Probe one source path. `null` = no usable bridge (relink degrades to
 *  "source checks unavailable" in a browser — never guesses a state). Never
 *  throws — a bridge error is reported the same as no bridge, matching
 *  `pathState`'s convention. */
export async function probeSource(path: string): Promise<SourceProbe | null> {
  const bridge = api();
  if (!bridge?.probe_source) return null;
  try {
    const out = await bridge.probe_source(path);
    const state = str(out.state);
    if (state === null || !(SOURCE_PROBE_STATES as readonly string[]).includes(state)) return null;
    return {
      state: state as SourceProbe["state"],
      path: str(out.path),
      size: num(out.size),
      mtime: num(out.mtime),
      checksum: str(out.checksum),
    };
  } catch {
    return null;
  }
}

/** Extend read consent to paths ALREADY recorded as a project's own
 *  `Dataset.source.path` values (quantized/desktop_bridge.py's
 *  `grant_source_paths` — see its doc for the consent ruling: opening the
 *  project itself already required a real dialog, and this extends that
 *  same trust to the sources IT declares, never to an arbitrary list).
 *  Returns the subset actually granted (files that exist), `[]` when there
 *  is no usable bridge — callers proceed with checksum-less probing rather
 *  than treating this as fatal, matching `openFiles`'s "no bridge = degrade,
 *  don't fail" convention. */
export async function grantSourceReadPaths(paths: string[]): Promise<string[]> {
  const bridge = api();
  if (!bridge?.grant_source_paths) return [];
  try {
    const out = await bridge.grant_source_paths(paths);
    const granted = out.paths;
    return Array.isArray(granted) ? granted.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** A real dialog failure AFTER the bridge was reached — distinct from both
 *  `CANCELLED` (the user backed out; nothing to report) and `null` (no
 *  usable bridge; fall back to typing), because the user DID act and
 *  deserves to hear why nothing happened (the same error-vs-cancel split
 *  `openProject`'s doc above rules on for its own post-pick failures). */
export interface PickDirError {
  error: string;
}

/** C1 (relink consent): native folder dialog for the relink panel's
 *  "Browse..." control (quantized/desktop_bridge_dialogs.py's
 *  `pick_relink_directory`) — UNLIKE `pickNativeDirectory` above, a real
 *  return from THIS dialog mints a read-only, session-scoped grant on the
 *  backend covering the chosen folder and its descendants, which is what
 *  lets `probeSource` compute a checksum for a candidate under it. `null` =
 *  no usable bridge (the caller falls back to a typed path, which can be
 *  Previewed but never gets a grant — see `probeSource`'s doc); `CANCELLED`
 *  = the user backed out of the dialog — do nothing, and specifically do
 *  NOT fall back to treating whatever was already typed as consented; a
 *  `PickDirError` = the dialog or the grant itself failed after a real
 *  attempt (backend `{path: null, error}` response, or the bridge call
 *  throwing) — the caller should SAY so, never silently swallow it as a
 *  cancel or misreport it as a missing bridge. */
export async function pickRelinkDirectory(
  directory?: string,
): Promise<string | Cancelled | PickDirError | null> {
  const bridge = api();
  if (!bridge?.pick_relink_directory) return null;
  try {
    const out = await bridge.pick_relink_directory(directory ?? "");
    const path = str(out.path);
    if (path !== null) return path;
    const error = str((out as { error?: unknown }).error);
    return error === null ? CANCELLED : { error };
  } catch (exc) {
    return { error: String(exc) };
  }
}

/** Revoke every grant `pickRelinkDirectory` minted this session
 *  (quantized/desktop_bridge_dialogs.py's `revoke_relink_dir`) — called when
 *  the relink panel closes (Cancel, the window's own close, or a completed
 *  commit) so the read-only grant never outlives the session that asked for
 *  it. Best-effort and silent: there is nothing a caller can usefully do
 *  with a failure here, and no bridge at all is simply a no-op. */
export async function revokeRelinkDir(): Promise<void> {
  const bridge = api();
  if (!bridge?.revoke_relink_dir) return;
  try {
    await bridge.revoke_relink_dir();
  } catch {
    // best-effort — nothing more a caller can do with a revoke failure
  }
}

// PR I2's filesystem project lock (P0-3/P1-1) wire calls live in the
// sibling lib/desktopLockBridge.ts — split out once this file neared the
// repo's general 500-line `.ts` ceiling (architecture.test.ts's
// RSM_CUTS_PLAN #20 guard). It reuses `api`/`str`/`bool`/`num` exported
// above rather than duplicating them.
