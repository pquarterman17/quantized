// The default, process-local `LockProvider` — extracted out of
// store/projectLock.ts under the repo's 500-line god-module ceiling
// (architecture.test.ts's RSM_CUTS_PLAN #20 guard; F1's post-await
// re-validation in `heartbeat()` pushed the store orchestrator over).
// Purely a file split — no behavior change. This is a self-contained,
// cohesive unit (own Map-backed CAS state, no dependency on anything else
// in store/projectLock.ts besides its two exported TYPES), the same
// "extract a cohesive sibling" shape lib/api/http.ts / lib/api/stats.ts
// already template for this exact ceiling. `LockProvider`/`LockCasResult`
// stay defined in store/projectLock.ts (the orchestrator that actually
// consumes/re-exports this) — importing them here as `import type` is a
// TYPE-only edge, erased at build time, so there is no runtime import
// cycle even though projectLock.ts imports this file's function as a
// value (the same "only a TYPE import crosses back" shape
// store/workspaceIO.ts already uses against store/useApp.ts).
//
// See store/projectLock.ts's own module header for the full design
// context (ATOMIC VERBS, the filesystem provider it's swapped for on a
// desktop shell, the two-browser-tabs gap) — none of that changed here.

import { acquire, canTakeOver, classifyLock, type LockRecord } from "../lib/lockState";
import type { LockProvider } from "./projectLock";

/** The default, process-local provider — live only for the brief window
 *  before App.tsx's install effects resolve. Genuinely atomic (same-turn,
 *  no `await` between its own read and write), but still honestly scoped to
 *  ONE process/tab — see store/projectLock.ts's module header. `App.tsx`
 *  swaps this out for `createDesktopLockProvider()`
 *  (lib/desktopLockProvider.ts) on a desktop shell, or
 *  `createBrowserLockProvider()` (lib/browserLockProvider.ts) on an
 *  ordinary browser tab (M4, coordinator review) — the SAME dynamic-import
 *  install shape either way, so this provider is never the one actually
 *  relied on once startup finishes. */
export function createInMemoryLockProvider(instanceId: string): LockProvider {
  const store = new Map<string, LockRecord>();
  let tokenSeq = 0;
  const mintRecord = (pid?: string): LockRecord => ({
    ...acquire(instanceId, Date.now(), pid),
    token: `mem-${instanceId}-${++tokenSeq}`,
  });

  return {
    read: async (path) => store.get(path) ?? null,

    tryAcquire: async (path) => {
      const now = Date.now();
      const current = store.get(path) ?? null;
      const status = classifyLock(current, instanceId, now);
      if (status !== "unlocked" && status !== "held-by-me") {
        return { acquired: false, record: current };
      }
      const record = mintRecord();
      store.set(path, record);
      return { acquired: true, record };
    },

    refresh: async (path, token) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== token) {
        return { acquired: false, record: current };
      }
      const updated: LockRecord = { ...current, heartbeatAt: Date.now() };
      store.set(path, updated);
      return { acquired: true, record: updated };
    },

    takeOver: async (path, expectedToken) => {
      const now = Date.now();
      const current = store.get(path) ?? null;
      if (current === null || current.token !== expectedToken) {
        return { acquired: false, record: current };
      }
      if (!canTakeOver(classifyLock(current, instanceId, now))) {
        return { acquired: false, record: current }; // no longer stale — refuse, don't clobber
      }
      const record = mintRecord();
      store.set(path, record);
      return { acquired: true, record };
    },

    release: async (path, token) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== token) return false;
      store.delete(path);
      return true;
    },
  };
}
