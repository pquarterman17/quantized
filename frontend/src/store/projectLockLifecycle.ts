import { useProjectLock } from "./projectLock";
import { beginProjectLockOperation } from "./projectLockEpoch";
import { BROWSER_AUTOSAVE_LOCK_PATH } from "./projectLockPaths";

/** Reserve a path as read-only while its asynchronous acquisition begins. */
export function reserveProjectLock(path: string): number {
  const reservation = beginProjectLockOperation();
  useProjectLock.setState({ path, status: "held-by-other-live", record: null, openedAsCopy: false, unverifiableHeartbeats: 0 });
  return reservation;
}

/** Detach immediately; release only a record owned by this instance. */
export function closeProjectLock(): void {
  const { provider, path, record, instanceId } = useProjectLock.getState();
  // This helper closes a NAMED project, so with no path there is nothing to
  // close. Every named open reserves its path synchronously first
  // (`reserveProjectLock`), so a null path is only ever browser autosave-slot
  // state: a declined slot (`openedAsCopy`, the flag that keeps this tab off
  // the shared slot) or its first engagement still in flight. Resetting
  // either would let a read-only tab overwrite the owning tab's autosave, as
  // would dropping the slot's app-lifetime lock itself.
  if (path === null || path === BROWSER_AUTOSAVE_LOCK_PATH) return;
  beginProjectLockOperation();
  if (record !== null && record.instanceId === instanceId) {
    void provider.release(path, record.token ?? "").catch(() => false);
  }
  useProjectLock.setState({ status: "unlocked", record: null, path: null, openedAsCopy: false, unverifiableHeartbeats: 0 });
}
