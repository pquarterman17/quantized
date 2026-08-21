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

/** An `UnverifiableLock` (corrupt/unparseable lock file — never an
 *  exception) refuses outright (`acquired: false, record: null`) AND sets
 *  `unverifiable: true` — the flag `store/projectLock.ts`'s
 *  `statusFromRefusal` checks BEFORE deriving a `LockStatus`, specifically
 *  so a corrupt lock file is never classified as `"unlocked"` (which
 *  `classifyLock(null, ...)` would otherwise report — the exact "assume
 *  free" guess this whole path exists to prevent). */
function toCasResult(out: LockWireOutcome | null, fallbackOk: boolean): LockCasResult {
  if (out === null) return { acquired: fallbackOk, record: null };
  if (out.unverifiable) return { acquired: false, record: null, unverifiable: true };
  return { acquired: out.ok, record: toLockRecord(out.record) };
}

export function createDesktopLockProvider(): LockProvider {
  return {
    read: async (path) => {
      const out = await readProjectLock(path);
      if (out === null || out.unverifiable) return null;
      return toLockRecord(out.record);
    },

    tryAcquire: async (path) => {
      const out = await acquireProjectLock(path);
      // `out === null` ("no bridge, or a thrown exception") must NEVER be
      // treated as "acquired" — `fallbackOk: false` is what keeps this
      // fail-closed, unlike a bare `out?.ok ?? true` would.
      return toCasResult(out, false);
    },

    refresh: async (path, token) => {
      const out = await refreshProjectLock(path, token);
      return toCasResult(out, false);
    },

    takeOver: async (path, expectedToken) => {
      const out = await takeOverProjectLock(path, expectedToken);
      return toCasResult(out, false);
    },

    release: async (path, token) => {
      return releaseProjectLock(path, token);
    },
  };
}
