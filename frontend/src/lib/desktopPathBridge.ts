// The folder picker and the path reachability probe, split out of
// lib/desktopBridge.ts (bundle diet slice 32) and re-exported from it with
// `export *`: only lazy chunks (the working-folder prompt, the relink flow,
// the Recent Projects reopen) call them.

import { api, str, type PathState } from "./desktopBridge";

const PATH_STATES: readonly PathState[] = ["ok", "missing", "offline", "invalid", "permission_denied"];

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
    return PATH_STATES.find((s) => s === state) ?? "unknown";
  } catch {
    return "unknown";
  }
}
