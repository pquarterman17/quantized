// The lock-provider contract: the atomic verbs every provider implements,
// what each resolves to, and the two helpers that interpret a result.
// Extracted from store/projectLock.ts (its 500-line ceiling); that module
// re-exports all of it, so existing import sites are unchanged.

import { classifyLock, type LockRecord, type LockStatus } from "../lib/lockState";

/** What every mutating verb below resolves to: did THIS call's own
 *  compare-and-swap land, and what does the provider now believe is on
 *  record (the freshly-written record on success, or whatever it found
 *  instead on refusal — never stale/cached, always what the provider just
 *  observed doing the CAS). `record: null` on a refusal means "nothing is
 *  there at all" (e.g. a takeover whose target was released out from under
 *  it), distinct from "something else is there" (a populated record). */
export interface LockCasResult {
  acquired: boolean;
  record: LockRecord | null;
  /** True when the provider found a lock file it could NOT verify at all
   *  (corrupt/unparseable — `desktop_project_lock.py`'s `UnverifiableLock`,
   *  never an exception). Distinct from `record: null`'s ordinary "nothing
   *  is there": `record` is ALSO `null` here (there is genuinely no
   *  trustworthy record to report), but a caller deriving a `LockStatus`
   *  from a refused result must check this FIRST — `classifyLock(null,
   *  ...)` alone would report `"unlocked"`, which is exactly the "assume
   *  free" guess this flag exists to prevent (lib/lockState.ts's own doc:
   *  "read-only, never assume free"). Optional so the in-memory provider,
   *  which has no unverifiable state to report, never needs to set it. */
  unverifiable?: boolean;
  /** R1's landed backend contract (main@fc85560): true on a SOFT SUCCESS —
   *  `acquired` is ALSO true here, the backend internally retried past a
   *  momentary OS-lock contention and still won. Purely informational;
   *  no caller needs to treat it specially — the normal `acquired: true`
   *  success path already does the right thing. (A BOUNDED refusal, where
   *  contention exhausted its retry budget, arrives as an ordinary
   *  `unverifiable: true` refusal instead — it is not a separate outcome.)
   *  Optional — unset for any provider/backend that predates this field. */
  contended?: boolean;
}

/** The I2 fix's actual seam (P0-3/P1-1): every mutation is ONE atomic call —
 *  no provider implementation may compose "read, decide, write" out of
 *  separate `read`+something-else calls with a gap an outside process could
 *  land in between; each verb below performs its own compare-and-swap
 *  in whatever way its backing store actually supports one (in-process,
 *  same-turn ordering for the in-memory provider; an exclusive OS-level
 *  file lock for the desktop filesystem provider — see
 *  `desktop_project_lock.py`). `read` is the one non-mutating, best-effort
 *  member — for display/classification only, never itself a basis for a
 *  write decision (every mutating verb re-verifies against the CURRENT
 *  record under its own CAS, regardless of what a prior `read` believed). */
export interface LockProvider {
  read: (projectPath: string) => Promise<LockRecord | null>;
  /** Acquire directly when the path is unlocked or already held by THIS
   *  provider's own identity; refuse (with the CURRENT record) otherwise —
   *  including a live OTHER holder, which this deliberately never takes
   *  over (that is `takeOver`'s job, gated by `canTakeOver` at the call
   *  site — see `lib/lockState.ts`'s L0.47 doc). */
  tryAcquire: (projectPath: string) => Promise<LockCasResult>;
  /** CAS heartbeat bump for the holder of `token`. A mismatch (including
   *  "no record at all") resolves `{ acquired: false, record }` — the
   *  caller LOST the lock and must drop to read-only. */
  refresh: (projectPath: string, token: string) => Promise<LockCasResult>;
  /** CAS replace — succeeds only when `expectedToken` still matches what's
   *  on record RIGHT NOW; mints an entirely new identity/token on success,
   *  same as `lib/lockState.ts`'s pure `takeOver`. */
  takeOver: (projectPath: string, expectedToken: string) => Promise<LockCasResult>;
  /** CAS delete — resolves `false` on a token mismatch OR a provider-side
   *  failure to actually remove the record (e.g. the desktop provider's
   *  Windows delete-while-open case — see `desktop_project_lock.py`'s
   *  `release` doc); never throws, never assumes success. */
  release: (projectPath: string, token: string) => Promise<boolean>;
}

/** The `LockStatus` a REFUSED `LockCasResult` implies. `unverifiable` wins
 *  over everything else — reused rather than adding a fifth `LockStatus`
 *  just for this, the exact same "read-only placeholder" convention
 *  `lib/openWorkspaceReplace.ts`'s `reserveLockForSwitch` already uses for
 *  its own conservative-by-default gap. Without this check, deriving
 *  status straight from `classifyLock(result.record, ...)` would see
 *  `record: null` and report `"unlocked"` — precisely the "assume free"
 *  guess an unverifiable refusal must never produce. (`contended` never
 *  reaches here — R1's landed contract only sets it alongside `acquired:
 *  true`, a success this function is never called for.) Exported (F4,
 *  code review follow-up) so every CAS-refusal call site derives status
 *  the SAME way — `store/workspaceIO.ts`'s `acquireDestinationLock` used
 *  to re-derive this inline; a second copy is exactly how that kind of
 *  drift happens. */
export function statusFromRefusal(result: LockCasResult, instanceId: string, now: number): LockStatus {
  if (result.unverifiable) return "held-by-other-live";
  return classifyLock(result.record, instanceId, now);
}

/** F1 (round 3, BLOCKING): `acquired: true` with `record: null` (a wire
 *  record that failed to parse — version skew) is NOT a success —
 *  trusting it stores `held-by-me`/`record: null`, which poisons
 *  `heartbeat()` (early-returns on `record === null` forever, never
 *  demoting) and `runSaveWorkspace` (empty token skips its own backend
 *  check — ungated write). Normalize into `unverifiable` so every
 *  existing handler (the demotion streak, `statusFromRefusal`) covers it —
 *  mirrors `acquireDestinationLock`'s pre-existing ad hoc guard. */
export function normalizeCasResult(result: LockCasResult): LockCasResult {
  if (result.acquired && result.record === null) {
    return { acquired: false, record: null, unverifiable: true };
  }
  return result;
}
