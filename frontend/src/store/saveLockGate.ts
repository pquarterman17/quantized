// Quick save writes to a KNOWN path with no dialog, so it must only do so when
// the lock machine is bound to that exact path. A project that is current
// while the lock tracks nothing (or another path) is a half-switched state —
// an undo/open that moved one without the other — and writing then would be
// completely ungated. Fail closed: refuse, and point at Save As. An explicit
// "Open as Copy" is the one deliberate lock-less writable session.

import type { ProjectIdentity } from "./project";

export function unboundLockRefusal(
  lock: { path: string | null; openedAsCopy: boolean },
  project: ProjectIdentity,
): string | null {
  return lock.path === project.path || lock.openedAsCopy
    ? null
    : `save refused — ${project.name} is not locked for editing here (it may have just been switched); use Save As to keep your work`;
}
