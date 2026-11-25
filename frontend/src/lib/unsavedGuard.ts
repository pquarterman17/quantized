// Unsaved-changes warning on close or reload (owner decision 2026-11-25, ON by
// default; Preferences ▸ General "Warn before closing with unsaved changes").
//
// A `beforeunload` listener that exists ONLY while it could matter: the pref is
// on AND the workspace holds unsaved work. The rule is the title bar's dot
// (components/Shell/TitleBar.tsx): a named project (native or browser file) is
// unsaved while `projectDirty`; an unnamed workspace is unsaved while it holds
// data. A clean workspace, or the pref off, leaves the page free to unload
// with no listener at all (and bfcache eligible).
//
// Lazy (main.tsx imports it after boot) and not installed under `?harness`
// (the e2e / visual harness seam: a native beforeunload dialog would hang a
// scripted reload) nor in the convert view.

import { useApp, type AppState } from "../store/useApp";
import { onPrefSlotChange } from "./prefSlots";
import { workflowPrefsSlot } from "./workflowPrefs";

/** Whether closing now would lose unsaved work the pref asks us to warn about. */
export function unsavedWarningActive(s: AppState = useApp.getState()): boolean {
  if (!workflowPrefsSlot.load().confirmUnsavedClose) return false;
  return s.currentProject || s.browserFileName ? s.projectDirty : s.datasets.length > 0;
}

function warn(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = ""; // legacy browsers need a value to show their own prompt
}

/** Keep the listener in step with the store and the pref; returns a disposer. */
export function installUnsavedGuard(): () => void {
  let on = false;
  const sync = (): void => {
    const want = unsavedWarningActive();
    if (want === on) return;
    on = want;
    if (on) window.addEventListener("beforeunload", warn);
    else window.removeEventListener("beforeunload", warn);
  };
  const offStore = useApp.subscribe(sync);
  const offPref = onPrefSlotChange((k) => k === workflowPrefsSlot.key && sync());
  sync();
  return () => {
    offStore();
    offPref();
    window.removeEventListener("beforeunload", warn);
    on = false;
  };
}
