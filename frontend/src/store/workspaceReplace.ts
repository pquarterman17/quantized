// "The whole workspace was just replaced" — File ▸ New / Open, Remove all, and
// the startup autosave restore all go through `loadWorkspace`, which announces
// it here. Module-level session state that belongs to the OLD workspace (the
// Curve Fit's DREAM session, the per-window stage-tab memory) subscribes and
// resets, instead of showing one workspace's leftovers beside another's data.
//
// KNOWN LIMIT (review N7, accepted): File ▸ Remove all is undoable, but it is
// a replace too, so it cancels a running DREAM job and forgets the session.
// Ctrl+Z brings the datasets back, not the job or its posterior table — rerun
// "Sample posterior". (The dataset scoping in useBumpsFit already hides a
// stale result; resetting is what stops an orphaned job from running on.)

const listeners = new Set<() => void>();

export function onWorkspaceReplace(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function announceWorkspaceReplace(): void {
  for (const fn of listeners) fn();
}
