import { beginProjectLockOperation, useProjectLock } from "./projectLock";

/** Reserve a path as read-only while its asynchronous acquisition begins. */
export function reserveProjectLock(path: string): number {
  const reservation = beginProjectLockOperation();
  useProjectLock.setState({ path, status: "held-by-other-live", record: null, openedAsCopy: false, unverifiableHeartbeats: 0 });
  return reservation;
}

/** Detach immediately; release only a record owned by this instance. */
export function closeProjectLock(): void {
  beginProjectLockOperation();
  const { provider, path, record, instanceId } = useProjectLock.getState();
  if (path !== null && record !== null && record.instanceId === instanceId) {
    void provider.release(path, record.token ?? "").catch(() => false);
  }
  useProjectLock.setState({ status: "unlocked", record: null, path: null, openedAsCopy: false, unverifiableHeartbeats: 0 });
}
