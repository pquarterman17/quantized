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
  // This helper closes a named project. The browser autosave slot is an
  // app-lifetime lock; dropping it makes the ordinary path-based write gate
  // disappear and would allow an unlocked tab to overwrite the shared slot.
  if (path === BROWSER_AUTOSAVE_LOCK_PATH) return;
  beginProjectLockOperation();
  if (path !== null && record !== null && record.instanceId === instanceId) {
    void provider.release(path, record.token ?? "").catch(() => false);
  }
  useProjectLock.setState({ status: "unlocked", record: null, path: null, openedAsCopy: false, unverifiableHeartbeats: 0 });
}
