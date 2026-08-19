// Single-writer project locking — the pure state machine (PR I2, L0.47).
// "if the same project is already open for editing, another Quantized
// instance opens it read-only and offers Open as Copy. Take Over Editing is
// deliberate and only proceeds after verifying that the first instance is
// closed or its lock is stale. Never permit silent concurrent writes to one
// project."
//
// Kept free of any I/O (no filesystem, no store, no clock read of its own —
// `now`/every timestamp is a parameter) so the four-state transition table
// below is exhaustively testable with plain objects, the same "pure
// planning, thin store orchestrator" split every other PR I module uses —
// store/projectLock.ts is the thin orchestrator that reads/writes an actual
// `LockRecord` through an injectable `LockProvider` (see that module's
// header for the filesystem-provider deferral and its written reason).
//
// STALENESS RULE (frozen-scope item 7's "define staleness explicitly"):
// a lock is STALE when its `heartbeatAt` is more than `STALE_AFTER_MS` old.
// The holder is expected to refresh `heartbeatAt` roughly every
// `HEARTBEAT_INTERVAL_MS` while it keeps the project open; three missed
// heartbeats (`STALE_AFTER_MS = 3 * HEARTBEAT_INTERVAL_MS`) is the threshold
// — long enough that one slow tick (a GC pause, a laptop briefly asleep,
// scheduler jitter) can never trip it, short enough that a genuinely dead
// instance (crashed, force-quit, network share dropped) is recognized
// within about a minute and a half rather than leaving a project locked
// indefinitely.
//
// FALSE-POSITIVE RISK (frozen-scope item 7's "and its false-positive risk"):
// a instance that is merely SUSPENDED — a laptop closed mid-edit, a debugger
// paused on a breakpoint — stops heartbeating without actually being gone,
// and will look stale to a second instance well before it would ever choose
// to give up the project itself. If that second instance takes over and the
// first later resumes, BOTH could believe they hold the lock. This module's
// answer is not to make the heuristic never wrong (impossible without a true
// process-liveness check this pure module cannot perform) but to make being
// wrong SAFE: `verifyBeforeWrite` is the second check every write-intending
// caller must pass — the moment the original holder's own next heartbeat
// attempt (or write) observes that the lock record no longer names its own
// `instanceId`, it has definitively lost the lock and must demote itself to
// read-only rather than trust its own earlier belief that it still held it.
// A stale-takeover false positive can cause a brief window of two instances
// both BELIEVING they can write; it can never cause two instances that both
// successfully commit a write the other doesn't know about, because the
// resumed original's very next write attempt is refused by this check.

export interface LockRecord {
  /** Opaque id unique to one running Quantized process (a session/tab, not
   *  a user) — store/projectLock.ts mints this once per process lifetime. */
  instanceId: string;
  /** Epoch ms the lock was first acquired (informational — Properties/
   *  status display; no transition below reads it). */
  acquiredAt: number;
  /** Epoch ms of the holder's most recent heartbeat — the ONLY field
   *  staleness is computed from. */
  heartbeatAt: number;
  /** Best-effort OS process id, when knowable (desktop shell only — a
   *  browser tab has none). Never load-bearing for any transition here;
   *  carried only for a human-readable "held by pid N" status line. */
  pid?: string;
}

export type LockStatus = "unlocked" | "held-by-me" | "held-by-other-live" | "held-by-other-stale";

/** A holder is expected to refresh roughly this often while editing. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Three missed heartbeats — see this module's header for the reasoning. */
export const STALE_AFTER_MS = 3 * HEARTBEAT_INTERVAL_MS;

/** Classify a lock record read from the provider. `record: null` means no
 *  one currently holds it (never written, or a clean release). */
export function classifyLock(record: LockRecord | null, myInstanceId: string, now: number): LockStatus {
  if (record === null) return "unlocked";
  if (record.instanceId === myInstanceId) return "held-by-me";
  return now - record.heartbeatAt > STALE_AFTER_MS ? "held-by-other-stale" : "held-by-other-live";
}

/** May this instance open the project read-write and acquire/refresh the
 *  lock outright, with no takeover step? True for `unlocked` (nothing to
 *  take over) and `held-by-me` (re-opening a project this SAME process
 *  already holds — re-entrant, not a second writer). */
export function canAcquireDirectly(status: LockStatus): boolean {
  return status === "unlocked" || status === "held-by-me";
}

/** L0.47's hard gate: Take Over Editing proceeds ONLY when the other
 *  holder's lock is stale — never merely because a user clicked the button.
 *  `held-by-other-live` always refuses; there is no override. */
export function canTakeOver(status: LockStatus): boolean {
  return status === "held-by-other-stale";
}

/** Must this project stay read-only right now? True for both "someone else
 *  has it" states — a stale lock does NOT become writable on its own; only
 *  an explicit, successful `canTakeOver`-gated takeover changes that. */
export function isReadOnly(status: LockStatus): boolean {
  return status === "held-by-other-live" || status === "held-by-other-stale";
}

/** Fresh lock record for THIS instance acquiring (or re-acquiring) the
 *  project — the only place a `LockRecord` is minted. */
export function acquire(myInstanceId: string, now: number, pid?: string): LockRecord {
  return { instanceId: myInstanceId, acquiredAt: now, heartbeatAt: now, ...(pid ? { pid } : {}) };
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

/** Release — only the actual holder can clear its own lock; releasing a
 *  lock this instance doesn't hold is a no-op signal (`false`) rather than
 *  clearing someone else's, so the caller can tell "released" from
 *  "nothing to release". */
export function canRelease(record: LockRecord | null, myInstanceId: string): boolean {
  return record !== null && record.instanceId === myInstanceId;
}
