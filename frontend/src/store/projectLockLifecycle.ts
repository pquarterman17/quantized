import { useProjectLock } from "./projectLock";
import { beginProjectLockOperation, DETACHED_LOCK } from "./projectLockEpoch";
import { BROWSER_AUTOSAVE_LOCK_PATH } from "./projectLockPaths";

/** The latest release of a project lock still in flight. Every re-acquire of
 *  a path (Undo of an open / Remove all, a quick File ▸ Open of the project just
 *  left) awaits it: acquiring while a release of the SAME path is pending is
 *  refused by the stale lock file, then the late release deletes the record we
 *  just took — the heartbeat then finds the project unlocked. */
let lastRelease: Promise<unknown> = Promise.resolve();
export const pendingProjectLockRelease = (): Promise<unknown> => lastRelease;
export function noteProjectLockRelease(released: Promise<unknown>): void {
  lastRelease = released;
}

/** Reserve a path as read-only while its asynchronous acquisition begins. */
export function reserveProjectLock(path: string): number {
  const reservation = beginProjectLockOperation();
  useProjectLock.setState({ ...DETACHED_LOCK, path, status: "held-by-other-live" });
  return reservation;
}

/** Detach immediately; release only a record owned by this instance. */
export function closeProjectLock(): void {
  void closeProjectLockAwaitable();
}

/** `closeProjectLock`, returning the release so a caller that re-acquires the
 *  same path soon after (Undo of Remove all) can wait for it to land instead
 *  of racing it. Never rejects. */
export function closeProjectLockAwaitable(): Promise<unknown> {
  const { provider, path, record, instanceId } = useProjectLock.getState();
  // This helper closes a NAMED project, so with no path there is nothing to
  // close. Every named open reserves its path synchronously first
  // (`reserveProjectLock`), so a null path is only ever browser autosave-slot
  // state: a declined slot (`openedAsCopy`, the flag that keeps this tab off
  // the shared slot) or its first engagement still in flight. Resetting
  // either would let a read-only tab overwrite the owning tab's autosave, as
  // would dropping the slot's app-lifetime lock itself.
  if (path === null || path === BROWSER_AUTOSAVE_LOCK_PATH) return Promise.resolve();
  beginProjectLockOperation();
  const released =
    record !== null && record.instanceId === instanceId ? provider.release(path, record.token ?? "").catch(() => false) : Promise.resolve();
  useProjectLock.setState({ ...DETACHED_LOCK, status: "unlocked" });
  lastRelease = Promise.all([lastRelease, released]);
  return released;
}
