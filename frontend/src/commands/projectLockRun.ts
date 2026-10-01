// The Take Over Editing / Open as Copy bodies, moved verbatim out of
// commands/projectLockCommands.ts so they load on first use instead of at
// startup (bundle diet slice 17, plans/BUNDLE_HEADROOM.md). See that module's
// header for why both refuse with a toast instead of being disabled, and why
// Open as Copy refuses the browser autosave slot first.

import { useProjectLock } from "../store/projectLock";
import { BROWSER_AUTOSAVE_LOCK_PATH } from "../store/projectLockPaths";
import { toast } from "../store/toasts";

export function takeOverEditing(): void {
  const lock = useProjectLock.getState();
  if (lock.status !== "held-by-other-stale") {
    toast(
      lock.status === "held-by-other-live"
        ? "Take Over Editing is not available — the other instance is still responding"
        : "nothing to take over — this project is not locked by another instance",
      "danger",
    );
    return;
  }
  void lock.takeOverEditing().then((ok) => {
    // Closed or switched projects meanwhile: the takeover was dropped, nothing to report.
    if (!ok && useProjectLock.getState().path !== lock.path) return;
    toast(ok ? "took over editing" : "take over failed — the other instance is responding again", ok ? "ok" : "danger");
  });
}

export function openAsCopy(): void {
  const lock = useProjectLock.getState();
  // Ordering (review round 4): the generic "not read-only" refusal
  // runs FIRST — a session that already holds (or is mid-engaging)
  // the autosave lock gets the accurate "nothing to copy" message,
  // never advice to "take over editing" it already has. The
  // browser-slot refusal below only applies where a copy would
  // otherwise be OFFERED (a genuinely read-only session).
  if (lock.status !== "held-by-other-live" && lock.status !== "held-by-other-stale") {
    toast("nothing to copy — this project is not currently read-only", "danger");
    return;
  }
  if (lock.path === BROWSER_AUTOSAVE_LOCK_PATH) {
    toast("this browser session has a single autosave slot — take over editing instead", "danger");
    return;
  }
  lock.openAsCopy();
  toast("opened as a copy — Save will prompt for a new location", "ok");
}
