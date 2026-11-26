// What a launch does with the autosaved session it found (owner decision
// 2026-11-26: "when I open Quantized it always opens a magnetometry project;
// I want the welcome menu"). Pure and tiny on purpose, like lib/recoveryChoice.ts:
// the one question worth testing in isolation is "load it, hold it for the
// welcome screen, or ask?".
//
// Root cause it fixes: the startup restore used to load the newest autosave
// generation unconditionally, so whatever the last session held (a magnetometry
// project, say) came back on every launch, with no pref and no way to start
// from the welcome screen. Now the default is the welcome screen, and nothing
// is discarded: a held session stays pinned in storage (lib/autosave.ts) until
// the user restores or discards it.

/** Preferences ▸ General ▸ On startup. */
export type StartupMode = "welcome" | "reopen";

export type StartupAction =
  /** No restorable autosave: an empty workspace and the welcome screen. */
  | "nothing"
  /** The workspace was touched, or the restore landed late: the non-blocking Append / Replace / Discard prompt. */
  | "late-prompt"
  /** Keep the session in storage and offer "Restore last session" on the welcome screen. */
  | "welcome-offer"
  /** The autosave is newer than the last named project: the Recover / Keep / Cancel dialog. */
  | "recovery-dialog"
  /** Load it (Preferences ▸ General ▸ On startup = Reopen last session). */
  | "restore";

export interface StartupInput {
  mode: StartupMode;
  /** A restorable autosave exists. */
  hasAutosave: boolean;
  /** The previous session never ran its unload handler (lib/sessionMarker.ts). */
  crashed: boolean;
  /** Landed late, or the user already replaced the workspace / opened / imported. */
  contended: boolean;
  /** The pick is newer than the last named project (lib/recoveryChoice.ts). */
  newerThanLastProject: boolean;
}

export function decideStartup(i: StartupInput): StartupAction {
  if (!i.hasAutosave) return "nothing";
  if (i.contended) return "late-prompt";
  // A crash is always OFFERED, whatever the pref: the last seconds of work may
  // be missing and the user should see that before anything loads.
  if (i.mode === "welcome" || i.crashed) return "welcome-offer";
  return i.newerThanLastProject ? "recovery-dialog" : "restore";
}
