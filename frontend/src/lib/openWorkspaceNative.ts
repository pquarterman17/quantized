// The desktop-shell branch of lib/openWorkspaceCommand.ts, loaded on the first
// Open / Append workspace click inside the desktop app (bundle diet,
// plans/BUNDLE_HEADROOM.md slice 34). A browser tab never reaches it: the
// command checks the synchronous `hasDesktopShell()` and runs the picker
// fallback in the click's own task, exactly as before. The branch was already
// asynchronous (it loaded the working-folder store before the native dialog),
// so the order is unchanged: working folders, then the native dialog, then
// the parse. A `CANCELLED` dialog is a no-op (never a picker fallback); a
// missing bridge (`null`) falls back to the picker.

import type { StoreGet } from "./exportActive";
import { CANCELLED, openProject } from "./desktopBridge";
import { baseName } from "./importEntry";
import { currentViewport } from "./currentViewport";
import type { LoadedWorkspace } from "./workspace";
import { beginOp, endOp } from "../store/pendingOps";
import type { ProjectIdentity } from "../store/project";
import { useWorkingPaths } from "../store/workingPaths";

export async function openNativeWorkspace(
  s: StoreGet,
  verb: string,
  label: string,
  dispatch: (ws: LoadedWorkspace, native?: ProjectIdentity) => void | Promise<void>,
  viaPicker: () => void,
): Promise<void> {
  const native = await openProject(useWorkingPaths.getState().current || undefined);
  if (native === CANCELLED) return; // the user backed out — never fall back
  if (native === null) {
    viaPicker();
    return;
  }
  const op = beginOp(label);
  void import("./openWorkspaceRun")
    .then((run) => run.openNativeContent(op, label, verb, s().setStatus, native, currentViewport()))
    .then((ws) => ws && dispatch(ws, { name: baseName(native.path), path: native.path }))
    .catch((e: unknown) => {
      endOp(op);
      s().setStatus(`${verb} failed: ${e instanceof Error ? e.message : "error"}`, "danger");
    });
}
