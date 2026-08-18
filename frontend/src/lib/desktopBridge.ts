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
  path_status?: (path: string) => Promise<Record<string, unknown>>;
  save_file_dialog?: (suggestedName?: string) => Promise<Record<string, unknown>>;
  write_project_file?: (path: string, content: string) => Promise<Record<string, unknown>>;
  open_project_file?: (directory?: string) => Promise<Record<string, unknown>>;
  read_project_file?: (path: string) => Promise<Record<string, unknown>>;
  probe_source?: (path: string) => Promise<Record<string, unknown>>;
  grant_source_paths?: (paths: string[]) => Promise<Record<string, unknown>>;
}

function api(): PyWebviewApi | null {
  const w = globalThis as { pywebview?: { api?: PyWebviewApi } };
  return w.pywebview?.api ?? null;
}

/** Is the desktop shell present at all? Cheap and synchronous — for deciding
 *  whether to even attempt a native call. Capability still needs `probe`. */
export function hasDesktopShell(): boolean {
  return api() !== null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean => v === true;
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

/** Native "Save As" dialog, then an in-process write of `contents` to the
 *  chosen path (quantized/desktop_bridge.py's `save_file_dialog` +
 *  `write_project_file`). `null` = no usable bridge OR the write itself
 *  failed after a real pick (fall back to the browser download — the
 *  content is not lost, just not landed at a native path); `CANCELLED` = the
 *  user backed out of the save dialog — do nothing, never fall back to a
 *  download the user did not ask for. */
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
 *  Exists for a future "Save" (as opposed to "Save As") once P1.2 tracks
 *  project identity; nothing in this slice calls it from a UI command yet
 *  (see desktop_bridge.py's "explicitly deferred" section). `null` covers
 *  both "no bridge" and "the write failed / the path was never consented" —
 *  there is no dialog here to cancel, so no `CANCELLED` outcome. */
export async function saveProjectTo(
  path: string,
  contents: string,
): Promise<SaveProjectResult | null> {
  const bridge = api();
  if (!bridge?.write_project_file) return null;
  try {
    const out = await bridge.write_project_file(path, contents);
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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

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
