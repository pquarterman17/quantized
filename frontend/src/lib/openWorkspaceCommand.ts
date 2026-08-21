// commands/fileCommands.ts's own size ratchet (RSM_CUTS_PLAN #20's general
// 500-line ceiling): P1.1 C3's native-open wiring pushed that module over,
// so this is the cohesive sibling extracted to offset it — the shared Open/
// Append-workspace flow, alongside its existing lib/openWorkspaceReplace.ts
// neighbor (the replace-and-confirm half of the same feature).

import { openFilePicker } from "./openFilePicker";
import { CANCELLED, hasDesktopShell, openProject } from "./desktopBridge";
import type { StoreGet } from "./exportActive";
import { currentViewport, parseWorkspaceFile } from "./parseWorkspaceFile";
import { parseWorkspace, type LoadedWorkspace } from "./workspace";
import { withOp } from "../store/pendingOps";
import type { ProjectIdentity } from "../store/project";

/** Basename of a native path, tolerant of either separator — mirrors
 *  lib/importEntry.ts's `parentDirectory` (the complementary half of a
 *  path) and store/workspaceIO.ts's identical private helper for the save
 *  side; kept local rather than shared, matching that existing precedent. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf(String.fromCharCode(92)));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/** Shared Open/Append-workspace flow (the only difference between the
 *  "open-workspace"/"open-workspace-safe"/"append-workspace" File commands
 *  that call this): pick a .dwk, parse it, and hand the result to `dispatch`
 *  (`loadWorkspace` or `appendWorkspace`).
 *
 *  P1.1 C3: tries a NATIVE open first (desktopBridge.ts's `openProject` — a
 *  real dialog, a real path, an in-process read) and falls back to the
 *  pre-existing `openFilePicker` flow whenever there is no usable bridge.
 *  The no-bridge branch checks the SYNCHRONOUS `hasDesktopShell()` (same
 *  guard `chooseAndImport` uses, same reason: `openProject` itself is
 *  `async`, so awaiting it before falling back would defer `openFilePicker`
 *  to a microtask even in a browser tab — this way the fallback runs
 *  synchronously inside `run()`, BYTE-IDENTICAL to this function's pre-P1.1
 *  body, and every existing test that reads the picker mock immediately
 *  after calling `run()` keeps passing untouched). A `CANCELLED` result is
 *  a no-op: the user backed out of the native dialog, and popping the
 *  browser picker right after would shove a second dialog in their face.
 *  Only a genuine native open records a Recent Projects entry
 *  (lib/recentProjects.ts's module doc explains why a browser-picked file,
 *  which the desktop bridge never saw, does not) — and, per DEFECT A's fix
 *  (2026-08-21), that push happens only once the workspace is ACTUALLY
 *  applied, not here: "open"/"open-safe" route through
 *  openWorkspaceReplace.ts's `replaceWorkspace`/`replaceWorkspaceSafely`
 *  (which sit behind fileCommands.ts's cancelable "Replace the current
 *  workspace?" confirm), and "append" pushes itself right where it commits
 *  (fileCommands.ts's append-workspace dispatch — appendWorkspace never
 *  gates on a confirm, so pushing there is never at risk of over-recording).
 *  A file read via the native dialog but never actually loaded (the confirm
 *  declined) must not pollute Recent Projects — see openWorkspaceReplace.ts's
 *  doc for why THAT is the single choke point for the two confirm-gated
 *  commands.
 *
 *  P3.4 slice 3: the picker's `onchange` callback fires the moment a file is
 *  chosen — well before any parsing starts — so the `withOp` busy state is
 *  registered HERE, inside the callback, not around the `openFilePicker`
 *  call itself (which would show "Opening…" while the OS file dialog is
 *  merely sitting open and the user hasn't picked anything yet). The parse
 *  itself runs off the main thread via `parseWorkspaceFile` (a module Worker
 *  when available, the prior synchronous path as a fallback) — see that
 *  module's doc comment for why the two paths can't diverge. The native
 *  path's content already arrived as an in-memory string (there is no File
 *  to hand a Worker), so it parses via the same `parseWorkspace` the worker
 *  path itself calls under the hood — same validation, same error shape,
 *  still wrapped in `withOp` for the identical "busy only once something is
 *  actually running" reason. */
export function openWorkspaceCommand(
  s: StoreGet,
  verb: string,
  // P1.2 box 1: `dispatch` now also receives the NATIVE identity (name+path)
  // when this open came from a real dialog, so a caller that actually
  // performs the replace (fileCommands.ts) can adopt it as `currentProject`
  // at the exact moment the replace happens — never before a confirm gate a
  // caller might still say no to. Undefined on the browser-picker path
  // (there is no durable path to adopt).
  dispatch: (ws: LoadedWorkspace, native?: ProjectIdentity) => void,
): () => void {
  const label = verb === "open" ? "Opening workspace…" : "Appending workspace…";
  const viaPicker = () =>
    openFilePicker((files) => {
      const file = files[0];
      if (!file) return;
      void withOp(label, () => parseWorkspaceFile(file, currentViewport()))
        .then(dispatch)
        .catch((e: unknown) =>
          s().setStatus(`${verb} failed: ${e instanceof Error ? e.message : "error"}`),
        );
    }, ".dwk,.json");

  return () => {
    if (!hasDesktopShell()) {
      viaPicker();
      return;
    }
    void openProject().then((native) => {
      if (native === CANCELLED) return; // the user backed out — never fall back
      if (native === null) {
        viaPicker();
        return;
      }
      void withOp(label, () => Promise.resolve(parseWorkspace(native.content, currentViewport())))
        .then((ws) => dispatch(ws, { name: baseName(native.path), path: native.path }))
        .catch((e: unknown) =>
          s().setStatus(`${verb} failed: ${e instanceof Error ? e.message : "error"}`),
        );
    });
  };
}
