// The lock operations only the lazy lock providers and the takeover flow call,
// split out of lib/lockState.ts (bundle diet slice 32) and re-exported from it
// with `export *`: the direct-acquire test, the heartbeat refresh, the stale
// takeover and the write-time ownership check. The classification and the
// record shape stay in lib/lockState.ts, which the eager lock code uses.

import { acquire, canTakeOver, classifyLock, type LockRecord, type LockStatus } from "./lockState";

/** May this instance open the project read-write and acquire/refresh the
 *  lock outright, with no takeover step? True for `unlocked` (nothing to
 *  take over) and `held-by-me` (re-opening a project this SAME process
 *  already holds — re-entrant, not a second writer). */
export function canAcquireDirectly(status: LockStatus): boolean {
  return status === "unlocked" || status === "held-by-me";
}

/** Refresh `record`'s heartbeat — ONLY valid when `record` is already held
 *  BY `myInstanceId`; refreshing a lock this instance does not hold would
 *  silently extend someone else's session, so this returns `null` instead
 *  (mirrors `desktop_consent`'s "never trust the caller" shape: ownership is
 *  verified against the record itself, not assumed from the call site). */
export function refreshHeartbeat(record: LockRecord, myInstanceId: string, now: number): LockRecord | null {
  if (record.instanceId !== myInstanceId) return null;
  return { ...record, heartbeatAt: now };
}

/** Take over a STALE lock — the ONE place `canTakeOver`'s gate is actually
 *  enforced at the data level (never trust a caller to have checked it):
 *  refuses (`null`) unless `classifyLock(current, myInstanceId, now)` is
 *  exactly `"held-by-other-stale"`. Success mints a completely fresh record
 *  for `myInstanceId` — the previous holder's `acquiredAt` is NOT carried
 *  forward, this is a new editing session, not a continuation. */
export function takeOver(current: LockRecord | null, myInstanceId: string, now: number, pid?: string): LockRecord | null {
  if (!canTakeOver(classifyLock(current, myInstanceId, now))) return null;
  return acquire(myInstanceId, now, pid);
}

/** THE false-positive safety net (this module's header, "FALSE-POSITIVE
 *  RISK"): may `myInstanceId` still safely write, given the CURRENT record
 *  read fresh from the provider right before the write? False whenever the
 *  record no longer names this instance — including `null` (someone
 *  cleanly released and re-acquired, or the record was cleared) — so a
 *  resumed-from-suspension instance that lost a stale-takeover race refuses
 *  its own write instead of silently clobbering the new holder's changes. */
export function verifyBeforeWrite(current: LockRecord | null, myInstanceId: string): current is LockRecord {
  return current !== null && current.instanceId === myInstanceId;
}
