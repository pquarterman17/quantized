// PR I2's filesystem project lock (P0-3/P1-1) — raw wire calls onto
// `quantized/desktop_bridge.py`'s `project_lock_*` js_api methods. Split
// out of `desktopBridge.ts` once that file neared the repo's general
// 500-line `.ts` ceiling (architecture.test.ts's RSM_CUTS_PLAN #20 guard) —
// this is the cohesive, self-contained half (own types, own five
// functions, no cross-references back into the rest of that file besides
// the shared `api`/`str`/`bool`/`num` helpers it now exports for exactly
// this reuse).
//
// Deliberately NOT typed against `store/projectLock.ts`'s
// `LockProvider`/`LockCasResult` — this file stays a plain wire layer, same
// as `desktopBridge.ts`'s own `SourceProbe`/`OpenProjectResult`;
// `lib/desktopLockProvider.ts` is what adapts these into the store's own
// `LockProvider` shape. `null` means "no usable bridge" throughout,
// matching every other function in `desktopBridge.ts`.

import { api, bool, num, str } from "./desktopBridge";

/** The lock record's wire shape — every field `desktop_project_lock.py`'s
 *  `LockRecord` serializes (see `desktop_bridge.py`'s `_lock_result`). */
export interface LockWireRecord {
  token: string;
  instanceId: string;
  hostname: string;
  pid: number;
  acquiredAt: number;
  heartbeatAt: number;
}

/** `ok` is the method's own outcome (`acquired`/`refreshed`/never
 *  meaningful for a plain read — see `readProjectLock`). `unverifiable`
 *  mirrors `desktop_project_lock.py`'s `UnverifiableLock` — true only when
 *  the backend could not trust the lock file's content at all (corrupt,
 *  unparseable); callers MUST treat that the same as "cannot verify —
 *  read-only", never as `record: null`'s ordinary "nothing is there".
 *
 *  `contended` (coordination note, R1/R4 concurrent-lane contract, backend
 *  side landing separately): true when the backend could not get the
 *  OS-level file lock for THIS attempt because another process's own CAS
 *  was mid-flight on it right now — transient, benign, "ask again next
 *  tick", and explicitly NOT the same as `unverifiable` (the content isn't
 *  untrustworthy, it was simply unreachable for an instant) or a genuine
 *  CAS mismatch (nothing has been positively observed to belong to anyone
 *  else). Optional so a backend that hasn't landed this yet is unaffected —
 *  every parse below defaults it to `false`. */
export interface LockWireOutcome {
  ok: boolean;
  record: LockWireRecord | null;
  unverifiable: boolean;
  contended?: boolean;
}

/** R4 (post-sprint independent review): guards against a MALFORMED
 *  response — an `out` that resolved (no thrown exception) but is not
 *  even a plain object (a bridge stub or version-skewed backend that
 *  resolves a bare string/number/boolean/array/`null`, say). Without this
 *  check, such a response would silently pass straight through `str`/
 *  `bool`/`num`'s own safe-but-SILENT per-field defaults — none of them
 *  throw on a primitive (`("x").acquired` is just `undefined`, not a
 *  `TypeError`) — into a coherent-looking
 *  `{ok:false, record:null, unverifiable:false}`, indistinguishable from
 *  a genuine "nothing holds this lock" answer and exactly the "assume we
 *  know" guess this whole module exists to prevent. This deliberately does
 *  NOT require every individual field to be present — an object missing
 *  one optional field is still coerced field-by-field the same as always
 *  (that's `str`/`bool`/`num`'s own job, and every existing fixture in
 *  this module's tests already relies on it) — only a non-object response
 *  is rejected outright. Every call site below treats a failed check here
 *  the SAME as "no usable bridge" (return `null`), which
 *  `lib/desktopLockProvider.ts`'s `toCasResult` already turns into an
 *  explicit `unverifiable: true` refusal.
 *
 *  F2 (code review follow-up): `typeof [] === "object"` in JS, so an ARRAY
 *  response — e.g. a stub bridge that resolves `[]` — passed this guard
 *  before the explicit `!Array.isArray` check below, coercing into the
 *  exact same coherent-looking-but-wrong `{ok:false, unverifiable:false}`
 *  this function exists to reject; the header above already (incorrectly)
 *  claimed arrays were covered. */
function isPlausibleOutcome(out: unknown): out is Record<string, unknown> {
  return typeof out === "object" && out !== null && !Array.isArray(out);
}

function parseLockRecord(v: unknown): LockWireRecord | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const token = str(o.token);
  const instanceId = str(o.instanceId);
  if (token === null || instanceId === null) return null;
  return {
    token,
    instanceId,
    hostname: str(o.hostname) ?? "",
    pid: num(o.pid) ?? 0,
    acquiredAt: num(o.acquiredAt) ?? 0,
    heartbeatAt: num(o.heartbeatAt) ?? 0,
  };
}

/** F3 (code review round 3): a wire response naming a record (`raw !==
 *  null`) that FAILS TO PARSE (missing `token`/`instanceId`, wrong field
 *  types, or not even an object) is NOT the same as "no record at all" —
 *  the backend HAS a lock file, it just couldn't be read reliably (a
 *  version-skew class of bug, or a read racing a concurrent write). That
 *  must be treated the SAME conservative way a corrupt lock file
 *  (`unverifiable: true`) already is. A genuinely absent record
 *  (`raw === null`) is real, verified information — "nothing holds this
 *  lock" — and stays `unparseable: false`. Every call site below ORs this
 *  into its own `unverifiable` bit. */
function parseRecordField(raw: unknown): { record: LockWireRecord | null; unparseable: boolean } {
  if (raw === null) return { record: null, unparseable: false };
  const record = parseLockRecord(raw);
  return { record, unparseable: record === null };
}

/** F6 (code review round 3, dedup): acquire/refresh/takeover collapse to
 *  the exact same parse — they differed ONLY in which field name carries
 *  "did this call succeed" (`acquired` for acquire/takeover, `refreshed`
 *  for refresh), which had left the shared `isPlausibleOutcome` +
 *  field-coercion block triplicated. Also applies F3's fix uniformly via
 *  `parseRecordField`. */
function parseCasOutcome(out: Record<string, unknown>, okField: "acquired" | "refreshed"): LockWireOutcome {
  const { record, unparseable } = parseRecordField(out.record);
  return {
    ok: bool(out[okField]),
    record,
    unverifiable: bool(out.unverifiable) || unparseable,
    contended: bool(out.contended),
  };
}

/** Acquire (or observe) the cross-process lock for `path` — the atomic
 *  create-or-take-over-if-stale primitive (`desktop_project_lock.acquire`).
 *  `ok` is `acquired`; a refusal still carries whatever record IS current. */
export async function acquireProjectLock(path: string): Promise<LockWireOutcome | null> {
  const bridge = api();
  if (!bridge?.project_lock_acquire) return null;
  try {
    const out = await bridge.project_lock_acquire(path);
    if (!isPlausibleOutcome(out)) return null;
    return parseCasOutcome(out, "acquired");
  } catch {
    return null;
  }
}

/** Read the current lock record for `path` with no side effect. `ok` is
 *  always `false` here — reading has no success/failure of its own, only a
 *  record (or the absence of one). */
export async function readProjectLock(path: string): Promise<LockWireOutcome | null> {
  const bridge = api();
  if (!bridge?.project_lock_read) return null;
  try {
    const out = await bridge.project_lock_read(path);
    if (!isPlausibleOutcome(out)) return null;
    const { record, unparseable } = parseRecordField(out.record);
    return { ok: false, record, unverifiable: bool(out.unverifiable) || unparseable };
  } catch {
    return null;
  }
}

/** CAS heartbeat bump for the holder of `token`. `ok: false` (including a
 *  token mismatch) means this instance LOST the lock — the caller must
 *  drop to read-only. */
export async function refreshProjectLock(path: string, token: string): Promise<LockWireOutcome | null> {
  const bridge = api();
  if (!bridge?.project_lock_refresh) return null;
  try {
    const out = await bridge.project_lock_refresh(path, token);
    if (!isPlausibleOutcome(out)) return null;
    return parseCasOutcome(out, "refreshed");
  } catch {
    return null;
  }
}

/** CAS takeover of a lock currently held under `expectedToken`. A mismatch
 *  refuses (`ok: false`) rather than clobbering whatever is there now. */
export async function takeOverProjectLock(path: string, expectedToken: string): Promise<LockWireOutcome | null> {
  const bridge = api();
  if (!bridge?.project_lock_takeover) return null;
  try {
    const out = await bridge.project_lock_takeover(path, expectedToken);
    if (!isPlausibleOutcome(out)) return null;
    return parseCasOutcome(out, "acquired");
  } catch {
    return null;
  }
}

/** Release this instance's own lock. `false` covers "no bridge", "token
 *  mismatch", AND a provider-side failure to remove the record (e.g. the
 *  Windows delete-while-open case — `desktop_project_lock.release`'s doc)
 *  — never throws, never assumes success. */
export async function releaseProjectLock(path: string, token: string): Promise<boolean> {
  const bridge = api();
  if (!bridge?.project_lock_release) return false;
  try {
    const out = await bridge.project_lock_release(path, token);
    return bool(out.released);
  } catch {
    return false;
  }
}
