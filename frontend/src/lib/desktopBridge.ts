// Typed access to the pywebview desktop bridge (MAIN_PLAN #31).
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

export interface DesktopCapabilities {
  available: boolean;
  shell: string | null;
  canPickFiles: boolean;
  canPickDirectory: boolean;
  cwd: string | null;
  home: string | null;
}

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

interface PyWebviewApi {
  probe?: () => Promise<Record<string, unknown>>;
  pick_files?: (directory?: string, multiple?: boolean) => Promise<Record<string, unknown>>;
  pick_directory?: (directory?: string) => Promise<Record<string, unknown>>;
  path_status?: (path: string) => Promise<Record<string, unknown>>;
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
      shell: str(p.shell),
      canPickFiles: bool(p.canPickFiles),
      canPickDirectory: bool(p.canPickDirectory),
      cwd: str(p.cwd),
      home: str(p.home),
    };
  } catch {
    return NO_DESKTOP;
  }
}

/** Native open-file dialog. Returns absolute paths the backend has already
 *  consented to read, or `null` when there is no usable bridge — `null` means
 *  "fall back to the picker", which is DIFFERENT from `[]` ("the user
 *  cancelled"), and conflating the two would re-open the browser picker every
 *  time someone backed out of the native one. */
export async function pickNativeFiles(directory?: string): Promise<string[] | null> {
  const bridge = api();
  if (!bridge?.pick_files) return null;
  try {
    const out = await bridge.pick_files(directory ?? "", true);
    const paths = out.paths;
    if (!Array.isArray(paths)) return null;
    return paths.filter((p): p is string => typeof p === "string");
  } catch {
    return null;
  }
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
