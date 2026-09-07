// "Pack Project" — the command body behind the File-menu "Pack Project…"
// row (commands/fileCommands.ts). Lazily imported on click (that module's
// own doc comment on the "pack-project" entry) so this file's own eager
// bundle cost — the desktop-shell check, `usePackProjectPanel`, and
// `store/packProject.ts` — stays off the startup path; only the metadata
// and the one `import()` arrow live in fileCommands.ts itself.
//
// No desktop shell (a browser tab): packing needs a native destination
// folder and a bridge-backed copy loop neither of which a browser tab can
// do, so this shows an explanatory toast and never opens the panel at all
// — matching desktopBridge.ts's own "no usable bridge -> the caller falls
// back" contract rather than opening a panel that can only ever fail.
//
// With a shell: open the panel FIRST, then kick off the preview. Opening
// first (not after a successful preview) is what lets the panel's own
// "selecting_destination"/"scanning" phases render while the native folder
// picker and the scan are in flight, rather than leaving the user staring
// at nothing until `previewPackProject` resolves.
//
// The store's own state machine can come back to `idle` in two ways that
// are NOT errors: the user backed out of the native destination picker, or
// (rare) desktopPackBridge finds no usable bridge despite `hasDesktopShell()`
// having said yes moments earlier. Either way there is nothing to review, so
// the panel closes itself rather than sitting open on an empty idle screen —
// PackProjectPanel.tsx's own mount-time race (`sawActive`) is the other half
// of this: it must not ALSO close the panel just because it hasn't yet seen
// a non-idle phase when it first renders.

import { hasDesktopShell } from "../lib/desktopBridge";
import { usePackProject } from "../store/packProject";
import { usePackProjectPanel } from "../store/packProjectPanel";
import { toast } from "../store/toasts";

export async function runPackProject(): Promise<void> {
  if (!hasDesktopShell()) {
    toast("Pack Project needs the desktop app", "info");
    return;
  }
  usePackProjectPanel.getState().setOpen(true);
  await usePackProject.getState().previewPackProject();
  if (usePackProject.getState().phase === "idle") {
    usePackProjectPanel.getState().setOpen(false);
  }
}
