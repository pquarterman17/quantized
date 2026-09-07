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
// The store comes back to `idle` for exactly one non-error reason: the user
// backed out of the native destination picker. There is then nothing to
// review, so the panel closes itself rather than sitting open on an empty
// idle screen. (A shell that turns out to have no usable pack bridge is a
// `failed` phase with `bridge_unavailable`, shown in the panel — never a
// silent idle.) PackProjectPanel.tsx's own mount-time race (`sawActive`) is
// the other half of this: it must not ALSO close the panel just because it
// hasn't yet seen a non-idle phase when it first renders. The run chunk is
// preloaded before the panel opens so that window is a single microtask.
//
// Two failure paths are handled here rather than left as unhandled
// rejections: a preview that throws (a rejected chunk load, a serialize
// error) resets the store when it is legal to and toasts; and a panel the
// user closed while the preview was still in flight abandons the preview
// (reset) instead of leaving the store active with no UI attached.

import { hasDesktopShell } from "../lib/desktopBridge";
import { usePackProject } from "../store/packProject";
import { usePackProjectPanel } from "../store/packProjectPanel";
import { toast } from "../store/toasts";

export async function runPackProject(): Promise<void> {
  if (!hasDesktopShell()) {
    toast("Pack Project needs the desktop app", "info");
    return;
  }
  await import("../store/packProjectRun"); // preload: the preview leaves idle without a chunk wait
  usePackProjectPanel.getState().setOpen(true);
  try {
    await usePackProject.getState().previewPackProject();
  } catch (e: unknown) {
    usePackProjectPanel.getState().setOpen(false);
    await resetIfLegal();
    toast(`pack preview failed — ${e instanceof Error ? e.message : "error"}`, "danger");
    return;
  }
  const phase = usePackProject.getState().phase;
  if (phase === "idle") {
    usePackProjectPanel.getState().setOpen(false);
  } else if (!usePackProjectPanel.getState().open) {
    await resetIfLegal(); // closed while the preview was in flight: abandon it
  }
}

async function resetIfLegal(): Promise<void> {
  const phase = usePackProject.getState().phase;
  if (phase !== "packing" && phase !== "cancelling") {
    await usePackProject.getState().resetPackProject();
  }
}
