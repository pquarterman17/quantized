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

//
// A second tab of the same profile finds the flag still set by the FIRST tab,
// which is alive. To tell that from a crash, a live tab also stamps a
// heartbeat (the flag's value, "1@<ms>") every BEAT_MS; a flag whose heartbeat is younger than
// BEAT_STALE_MS belongs to a live tab ("other-tab"), not a crash. A crash
// reopened inside that window reads as "other-tab", i.e. under-reports, the
// same safe direction as above.

export const ACTIVE_KEY = "qz.session.active";
export const BEAT_MS = 5_000;
export const BEAT_STALE_MS = 15_000;

export type SessionEnd = "clean" | "unclean" | "first-run" | "other-tab";

/** The flag is "1" (no heartbeat known) or "1@<epoch ms>" (live tab's beat). */
function otherTabAlive(raw: string): boolean {
  const at = Number(raw.slice(2));
  return Number.isFinite(at) && at > 0 && Math.abs(Date.now() - at) < BEAT_STALE_MS;
}

/** How the PREVIOUS session ended. Call once, before `markSessionActive`. */
export function priorSessionEnd(): SessionEnd {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw === null) return "first-run";
    if (!raw.startsWith("1")) return "clean";
    return otherTabAlive(raw) ? "other-tab" : "unclean";
  } catch {
    return "first-run"; // storage unavailable — never claim a crash we can't see
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
  const beat = () => {
    try {
      localStorage.setItem(ACTIVE_KEY, `1@${Date.now()}`);
    } catch {
      /* storage unavailable */
    }
  };
  // Re-asserting the flag keeps a still-live tab marked running after a
  // sibling tab's clean close wrote "0".
  beat();
  const timer = setInterval(beat, BEAT_MS);
  const onEnd = () => markSessionClean();
  window.addEventListener("beforeunload", onEnd);
  window.addEventListener("pagehide", onEnd);
  return () => {
    clearInterval(timer);
    window.removeEventListener("beforeunload", onEnd);
    window.removeEventListener("pagehide", onEnd);
  };
}

// `markSessionActive` live in ./sessionMarkerMark.ts: no eager module uses them.
export * from "./sessionMarkerMark";
