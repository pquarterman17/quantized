// The desktop filesystem `LockProvider` (I2 audit fix, P0-3/P1-1) — adapts
// `desktopLockBridge.ts`'s raw `project_lock_*` wire calls into
// `store/projectLock.ts`'s `LockProvider` shape. `App.tsx` installs this via
// `useProjectLock.getState().setProvider(createDesktopLockProvider())` the
// moment a desktop shell is detected (`hasDesktopShell()`), replacing the
// in-memory default; nothing in the store itself needs to know which
// provider is live — both satisfy the exact same interface.
//
// Every method here is a THIN translation, not new policy: the actual
// compare-and-swap lives entirely in `desktop_project_lock.py` (reached
// through `desktop_bridge.py`'s consent-gated `project_lock_*` methods —
// see that module's "PR I2" section). This file's only job is turning the
// bridge's wire shape (`LockWireOutcome`/`LockWireRecord`) into
// `lib/lockState.ts`'s `LockRecord` and `store/projectLock.ts`'s
// `LockCasResult`, and treating "no bridge" / "an unverifiable lock file"
// / a thrown exception the same conservative way every other provider
// method in this codebase already does: never guess writable.

import {
  acquireProjectLock,
  readProjectLock,
  refreshProjectLock,
  releaseProjectLock,
  takeOverProjectLock,
  type LockWireOutcome,
  type LockWireRecord,
} from "./desktopLockBridge";
import type { LockRecord } from "./lockState";
import type { LockCasResult, LockProvider } from "../store/projectLock";

function toLockRecord(wire: LockWireRecord | null): LockRecord | null {
  if (wire === null) return null;
  return {
    instanceId: wire.instanceId,
    acquiredAt: wire.acquiredAt,
    heartbeatAt: wire.heartbeatAt,
    pid: String(wire.pid),
    token: wire.token,
  };
}

/** R4 fix (post-sprint independent review — was: `toCasResult(null, false)`
 *  returned a refusal with `record: null` and NO `unverifiable` flag,
 *  which `store/projectLock.ts`'s `statusFromRefusal` then classified as
 *  plain `"unlocked"` — the exact "assume free" guess this whole path
 *  exists to prevent, and precisely how open/heartbeat/takeover could
 *  report `readOnly: false` after the bridge call never actually
 *  succeeded).
 *
 *  `out === null` covers THREE distinct failure shapes, collapsed at the
 *  wire layer (`lib/desktopLockBridge.ts`'s own doc): no bridge method at
 *  all, the bridge call THROWING, and a MALFORMED response (not even a
 *  plain object — `isPlausibleOutcome`'s guard there). None of the three
 *  is "nothing holds this lock" — they are all "we could not ask", so
 *  every one of them now maps to the SAME explicit `unverifiable: true`
 *  refusal a corrupt/unparseable lock file already produced (an
 *  `UnverifiableLock`, `out.unverifiable === true`, never an exception).
 *  There is deliberately no longer a `fallbackOk` parameter — every call
 *  site below always wanted `false` (never guess acquired on ANY failure
 *  shape), and the parameter's mere existence is what let the `out ===
 *  null` branch quietly skip setting the flag in the first place.
 *
 *  `out.contended` — R1's now-landed backend contract (main@fc85560):
 *  `contended` rides a SUCCESS (`ok`/`acquired: true`, a "soft success"
 *  after the backend internally retried past momentary OS-lock
 *  contention) — purely informational, never a refusal on its own. A
 *  BOUNDED refusal (contention exhausted its retry budget) arrives as an
 *  ordinary `unverifiable: true` refusal, already handled above. This
 *  function therefore does NOT special-case `contended` at all — it is
 *  passed straight through on whatever `out.ok` actually says, exactly
 *  like every other informational field. (An earlier version of this
 *  function forced `contended: true` into a fake `acquired: false`
 *  refusal, based on a since-superseded pre-landing guess at the wire
 *  shape — that would have silently dropped every real soft-success.) */
function toCasResult(out: LockWireOutcome | null): LockCasResult {
  if (out === null) return { acquired: false, record: null, unverifiable: true };
  if (out.unverifiable) return { acquired: false, record: null, unverifiable: true };
  return { acquired: out.ok, record: toLockRecord(out.record), contended: out.contended };
}

export function createDesktopLockProvider(): LockProvider {
  return {
    // `read` stays a bare `LockRecord | null` (store/projectLock.ts's
    // `LockProvider.read` contract — display/classification only, never
    // itself a write decision) — a `null` here from ANY cause (no bridge,
    // a thrown call, a malformed response, OR a genuinely unverifiable
    // lock file) is equally non-authoritative, because every MUTATING verb
    // below re-verifies independently via its own CAS and now correctly
    // flags `unverifiable` on refusal regardless of what a prior `read`
    // believed — see this module's header and `store/projectLock.ts`'s own
    // "read is the one non-mutating, best-effort member" doc.
    read: async (path) => {
      const out = await readProjectLock(path);
      if (out === null || out.unverifiable) return null;
      return toLockRecord(out.record);
    },

    tryAcquire: async (path) => toCasResult(await acquireProjectLock(path)),

    refresh: async (path, token) => toCasResult(await refreshProjectLock(path, token)),

    takeOver: async (path, expectedToken) => toCasResult(await takeOverProjectLock(path, expectedToken)),

    release: async (path, token) => {
      return releaseProjectLock(path, token);
    },
  };
}
