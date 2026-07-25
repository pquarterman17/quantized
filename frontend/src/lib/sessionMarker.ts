// Clean-shutdown detection (MAIN_PLAN #32): did the previous session end
// normally, or did it crash / get killed?
//
// Autosave restores unconditionally, which is right — this is a workspace app
// and users expect their library back. What was missing is the DISTINCTION: a
// restore after an ordinary close is unremarkable, but a restore after a crash
// is something the user should be told about, because it is the case where the
// last few seconds of work may be missing and they should check.
//
// Mechanism: a flag written at startup and removed on a clean unload. If it is
// still present at the next startup, the previous session never got to run its
// unload handler.
//
// localStorage, not sessionStorage: sessionStorage is per-tab and cleared when
// the tab closes, so it can never report on a session that died. The cost is
// that the flag is shared across tabs — with two tabs open, the first to close
// cleanly clears it. That is acceptable for a desktop-style single-window app
// (`qz --desktop` is one window) and errs toward under-reporting a crash rather
// than crying wolf, which is the safer direction for a notice like this.

const ACTIVE_KEY = "qz.session.active";

export type SessionEnd = "clean" | "unclean" | "first-run";

/** How the PREVIOUS session ended. Call once, before `markSessionActive`. */
export function priorSessionEnd(): SessionEnd {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw === null) return "first-run";
    return raw === "1" ? "unclean" : "clean";
  } catch {
    return "first-run"; // storage unavailable — never claim a crash we can't see
  }
}

/** Mark this session running. Safe to call more than once. */
export function markSessionActive(): void {
  try {
    localStorage.setItem(ACTIVE_KEY, "1");
  } catch {
    /* storage unavailable — crash detection degrades to "first-run" */
  }
}

/** Mark a clean shutdown. Wired to `beforeunload`/`pagehide`. */
export function markSessionClean(): void {
  try {
    localStorage.setItem(ACTIVE_KEY, "0");
  } catch {
    /* storage unavailable */
  }
}

/** Install the lifecycle listeners; returns a teardown for tests/unmount.
 *
 *  BOTH events are registered on purpose: `beforeunload` does not fire reliably
 *  on mobile or when a tab is discarded, and `pagehide` is the recommended
 *  modern replacement. Marking clean twice is harmless. */
export function installSessionMarker(): () => void {
  markSessionActive();
  const onEnd = () => markSessionClean();
  window.addEventListener("beforeunload", onEnd);
  window.addEventListener("pagehide", onEnd);
  return () => {
    window.removeEventListener("beforeunload", onEnd);
    window.removeEventListener("pagehide", onEnd);
  };
}
