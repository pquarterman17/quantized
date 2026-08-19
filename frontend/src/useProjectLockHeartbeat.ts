// PR I2 (L0.47) heartbeat scheduling — the store bridge, mirroring
// useWorkspaceAutosave.ts's own "hook wires the effect, the store itself
// stays a plain testable object" split. store/projectLock.ts's `heartbeat()`
// is the actual logic (and the false-positive safety net); without SOMETHING
// calling it on an interval, a perfectly healthy held-by-me session would
// silently go stale after STALE_AFTER_MS and become takeover-vulnerable —
// this hook is that something.

import { useEffect } from "react";

import { HEARTBEAT_INTERVAL_MS } from "./lib/lockState";
import { useProjectLock } from "./store/projectLock";

export function useProjectLockHeartbeat(): void {
  const status = useProjectLock((s) => s.status);
  useEffect(() => {
    if (status !== "held-by-me") return;
    const id = setInterval(() => {
      void useProjectLock.getState().heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);
}
