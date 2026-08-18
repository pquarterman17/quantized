// Crash-recovery decision (P1.2 box "explain crash recovery source/time/
// choices" — "never silently auto-restore over a named project"). Pure and
// tiny on purpose: the ONE question worth getting right in isolation is
// whether the autosave candidate is actually newer than what the user last
// had open — everything else (the dialog copy, the three choices) is UI.
//
// Before P1.2, useWorkspaceAutosave.ts always silently loaded the newest
// restorable autosave generation on startup, with no comparison against
// anything named. That was safe as long as nothing WAS named — there was no
// `currentProject` concept yet. Now that a project can have a durable
// identity (store/project.ts), silently restoring an autosave that is OLDER
// than (or equal to) the last time that project was known-good would be
// pointless (nothing to recover), and restoring one that IS newer without
// asking would risk quietly discarding the user's mental model of "what's
// open" the moment they see something they didn't expect.

/** The last project the user had a durable identity for, before this
 *  startup — the most recent Recent Projects entry, if any. `at` is that
 *  entry's own timestamp (epoch ms), NOT necessarily when the project file
 *  itself was last modified on disk — see this module's docs at the call
 *  site (useWorkspaceAutosave.ts) for why that's the right proxy anyway
 *  (Recent Projects is bumped on every successful native open OR save). */
export interface LastProjectRef {
  name: string;
  path: string;
  at: number;
}

/** True only when there IS a last-known project AND the autosave candidate
 *  is strictly newer than it. `null` (no last project) always answers
 *  false — there is nothing named to protect, so the pre-P1.2 silent
 *  restore stays exactly as it was in that case. Equal timestamps also
 *  answer false: nothing to recover that the named project doesn't already
 *  reflect. */
export function shouldOfferRecoveryChoice(
  autosaveAt: number,
  lastProject: LastProjectRef | null,
): boolean {
  return lastProject !== null && autosaveAt > lastProject.at;
}
