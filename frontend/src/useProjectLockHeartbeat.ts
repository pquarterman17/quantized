// PR I2 (L0.47) heartbeat scheduling — the store bridge, mirroring
// useWorkspaceAutosave.ts's own "hook wires the effect, the store itself
// stays a plain testable object" split. store/projectLock.ts's `heartbeat()`
// is the actual logic (and the false-positive safety net); without SOMETHING
// calling it on an interval, a perfectly healthy held-by-me session would
// silently go stale after STALE_AFTER_MS and become takeover-vulnerable —
// this hook is that something.
//
// R4 (post-sprint independent review) — RECOVERY: this also keeps ticking
// for a while PAST a demotion caused by an unverifiable bridge (status no
// longer `"held-by-me"`, but `unverifiableHeartbeats > 0` — see
// store/projectLock.ts's `heartbeat()` doc), not only while `held-by-me`.
// Without this, the interval would tear itself down the instant the status
// flips away from `held-by-me` and NEVER call `heartbeat()` again — no
// later tick could ever discover a bridge that comes back, and the session
// would be stuck read-only until the user manually reopens the project.
// `unverifiableHeartbeats` resets to 0 on every definite loss/explicit
// re-open/release (store/projectLock.ts), so this never keeps polling a
// session that has genuinely lost the lock to someone else or closed it.

import { useEffect } from "react";

import { HEARTBEAT_INTERVAL_MS } from "./lib/lockState";
import { useProjectLock } from "./store/projectLock";

export function useProjectLockHeartbeat(): void {
  const active = useProjectLock((s) => s.status === "held-by-me" || s.unverifiableHeartbeats > 0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      void useProjectLock.getState().heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);
}
