// The native-dialog twin of `importFilesAppended` (store/importAppend.ts),
// moved out of the entry chunk (bundle diet slice 37, `plans/BUNDLE_HEADROOM.md`):
// only the lazy file-command bodies (commands/fileCommandsLazy.ts) call it.

import { toast } from "./toasts";
import type { AppendRunOptions } from "./importAppendRun";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

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
