// The browser-tab `LockProvider` (closes the "browser multi-tab" defer named
// in `plans/RELEASE_BLOCKERS.md`'s I2 entry). `store/projectLock.ts`'s own
// header spells out the gap this fills: `qz` (no `--desktop`) serves the SPA
// over plain HTTP, and nothing stopped opening the SAME project in two
// ordinary browser TABS against that one server — the in-memory default
// provider is honestly process-local (one Map per tab), so two tabs got ZERO
// mutual-exclusion protection. This module gives tabs of the SAME BROWSER a
// shared record; it is still an origin-scoped, client-side mechanism — see
// "HONEST SCOPE" below for exactly what it does and does not cover.
//
// CONTRACT: implements `store/projectLock.ts`'s `LockProvider` exactly, the
// same shape `store/inMemoryLockProvider.ts` and `lib/desktopLockProvider.ts`
// already satisfy — no new verbs, no change to `lib/lockState.ts`'s
// classification/staleness rules. This file is pure translation: CAS onto
// `localStorage` instead of a `Map` (in-memory) or an OS file lock (desktop).
//
// PRIMITIVES CHOSEN, AND WHY:
//  - `localStorage` is the RECORD. It is the one storage primitive every tab
//    of the same origin already shares synchronously, which is exactly what
//    `read`/`classifyLock`'s staleness math need (token/instanceId/
//    heartbeatAt visible to every other tab without any message-passing).
//  - The Web Locks API (`navigator.locks.request`) — where available, in a
//    secure context — guards the actual read-compare-write CRITICAL SECTION
//    of every mutating verb as a named mutex per project path
//    (`qz-project-lock-cas:<path>`). This is deliberately NOT used to
//    express the token CAS itself (an earlier design considered holding a
//    Web Lock for the DURATION of "this tab owns the project", but that
//    would smuggle a second, undocumented staleness signal past
//    `lib/lockState.ts`'s heartbeat-only rule — exactly the "new lock
//    semantics" the task ruled out). Its role here is narrower and safer: a
//    real cross-tab mutex around the few synchronous lines that read, decide,
//    and write, so two tabs' CAS attempts can never physically interleave.
//    Auto-release-on-death is what makes it safe to use as a mutex at all —
//    if a tab crashes mid critical-section, the browser drops its held lock
//    immediately, so no other tab can ever be stuck queued behind a corpse.
//  - FALLBACK (no Web Locks — an older browser, or a non-secure context,
//    where `navigator.locks` is simply absent): every verb still runs its
//    read-compare-write with NO `await` between the read and the write, so
//    within one JS realm nothing else in that SAME tab can interleave
//    (ordinary single-threaded-JS reasoning — no different from the
//    in-memory provider's own atomicity argument). This does NOT rule out a
//    genuine cross-process race between two REAL tabs at the native
//    `localStorage` layer in this degraded mode — that residual window is
//    exactly what the Web Locks mutex above exists to close, and is honestly
//    absent only when the platform itself lacks Web Locks. Heartbeat
//    staleness (`lib/lockState.ts`) remains the backstop either way: even a
//    lost race is bounded by `STALE_AFTER_MS`, never a permanent split-brain.
//
// HONEST SCOPE: this protects tabs of the SAME BROWSER (same profile, same
// origin's `localStorage`) opening the same project against the same `qz`
// server. It does nothing for two DIFFERENT browsers, two machines, or two
// browser profiles/containers — `localStorage` is not shared across any of
// those, and nothing here pretends otherwise. That boundary is the
// filesystem lock's domain (`lib/desktopLockProvider.ts`, desktop-shell
// only) or, on the web, would need a SERVER-side lock this client-only
// module deliberately does not add (out of this task's scope — the frontend
// `LockProvider` contract has no server leg for `qz` without `--desktop`).
//
// FAIL-CLOSED: mirrors `lib/desktopLockBridge.ts`'s R4 precedent exactly —
// a malformed/foreign-version record, a thrown `localStorage` access (Safari
// private-mode quota, a locked-down embed), or a `navigator.locks` request
// that itself throws all resolve `{ acquired: false, record: null,
// unverifiable: true }` (or `read` -> `null`, `release` -> `false`) — never a
// guessed success, never a thrown exception out of this module.
//
// RELEASE ON TAB CLOSE (coordinator review round, M2/M3): best-effort only —
// a `pagehide` listener releases every path this INSTANCE still believes it
// holds (tracked in `heldPaths` below), using the SAME token-CAS logic the
// other verbs use so it can never clobber a path someone else has since
// taken over. Two hardening fixes from the review:
//  - M3: `beforeunload` is NOT wired to release at all — it fires for a page
//    merely being frozen into the back/forward cache, not only a real
//    unload, and it carries no way to tell the two apart. `pagehide`'s own
//    `event.persisted` flag IS that signal: `false` is a genuine unload
//    (release); `true` means bfcache is preserving this exact JS context
//    (this tab's `heldPaths`/token survive untouched) — the installing side
//    (App.tsx) re-validates via the EXISTING `heartbeat()` state-machine
//    entry point on the matching `pageshow` restore, not this module.
//  - M2: the read-decide-remove is now routed through the SAME `withCas`
//    mutex the other four verbs use, closing the same read-then-act TOCTOU
//    window a bare compare-and-delete would otherwise have against a
//    concurrent `takeOver` (a delayed, unconditional `removeItem` deciding
//    from a STALE captured read could otherwise delete a fresh winner's
//    brand-new record). When Web Locks is unavailable, this degrades to
//    the same single synchronous compare-and-delete block as before — a
//    narrow residual, same class as every other verb's documented no-mutex
//    fallback risk, not a new one.
// A hard crash (no unload event at all) leaves the record in place until
// `STALE_AFTER_MS` passes, exactly like a killed desktop process leaves its
// OS lock file until the same staleness math takes over — the pure state
// machine in `lib/lockState.ts` was written to tolerate exactly this.
//
// DISPOSAL (M6): `subscribeUnload` returns an unsubscribe, and the provider
// exposes it as `dispose()` — an extra property beyond the plain
// `LockProvider` shape (every existing `LockProvider` call site is
// unaffected; only the installing effect in App.tsx reads it). Without this,
// a React StrictMode double-mount (or any remount) of the installing effect
// would register a second permanent `pagehide` listener with no way to
// remove the first, leaking one per remount — mirrors
// `lib/sessionMarker.ts`'s `installSessionMarker()` returning its own
// teardown for the identical reason.

import { acquire, classifyLock, canTakeOver, type LockRecord } from "./lockState";
import type { LockCasResult, LockProvider } from "../store/projectLock";

const STORAGE_PREFIX = "qz-project-lock:v1:";

function storageKey(path: string): string {
  return STORAGE_PREFIX + path;
}

interface StoredEnvelope {
  v: 1;
  record: LockRecord;
}

/** Defensive parse, the same style `lib/desktopLockBridge.ts`'s
 *  `parseLockRecord`/`isPlausibleOutcome` use: reject anything that is not
 *  EXACTLY the expected shape rather than silently coercing. A record that
 *  fails this (wrong version, missing/mistyped field, or not even an
 *  object) is NOT "nothing is there" — something untrustworthy is there —
 *  so it is reported `unverifiable`, never folded into "unlocked". */
function parseEnvelope(raw: string | null): { record: LockRecord | null; unverifiable: boolean } {
  if (raw === null) return { record: null, unverifiable: false };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { record: null, unverifiable: true };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { record: null, unverifiable: true };
  const o = obj as Record<string, unknown>;
  if (o.v !== 1) return { record: null, unverifiable: true }; // foreign/future schema version
  const record = parseLockRecord(o.record);
  if (record === null) return { record: null, unverifiable: true };
  return { record, unverifiable: false };
}

function parseLockRecord(v: unknown): LockRecord | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const instanceId = typeof o.instanceId === "string" ? o.instanceId : null;
  const token = typeof o.token === "string" ? o.token : null;
  const acquiredAt = typeof o.acquiredAt === "number" ? o.acquiredAt : null;
  const heartbeatAt = typeof o.heartbeatAt === "number" ? o.heartbeatAt : null;
  if (instanceId === null || token === null || acquiredAt === null || heartbeatAt === null) return null;
  return { instanceId, token, acquiredAt, heartbeatAt };
}

/** Minimal shape this module actually calls — narrower than the DOM's
 *  `Storage` so a hand-rolled test fake never has to implement the unused
 *  parts (`length`/`key`/`clear`). */
export type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Minimal shape of `navigator.locks.request` this module actually calls —
 *  the real Web Locks API supports options/AbortSignal/etc. we never need. */
export type LockRequester = (name: string, fn: () => unknown) => Promise<unknown>;

/** Injectable seams — production code takes none of these (see the two
 *  `default*` functions below); tests inject fakes so two "tabs" can share
 *  one storage/lock-manager pair deterministically, with no real browser. */
export interface BrowserLockDeps {
  storage?: MinimalStorage;
  lockRequest?: LockRequester | null;
  /** Registers `fn` to run on a genuine tab close (see "RELEASE ON TAB
   *  CLOSE" above) and returns an unsubscribe — M6: the installing effect
   *  calls it on cleanup so a remount never leaks a second listener. */
  subscribeUnload?: (fn: () => void) => () => void;
  /** TEST-ONLY seam (never set in production): awaited, if provided, between
   *  the CAS read and the CAS write in every mutating verb — the deferred-
   *  promise hook `docs/testing.md`'s evidence standard calls for, letting a
   *  test FORCE two calls to interleave inside the critical section instead
   *  of merely hoping timing cooperates. See browserLockProvider.test.ts's
   *  "forces the …" tests for the worked usage. */
  yieldForTest?: () => Promise<void>;
}

function safeLocalStorage(): MinimalStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // some embeds/private modes throw on the mere reference
  }
}

function defaultLockRequest(): LockRequester | null {
  try {
    const locks = (navigator as unknown as { locks?: { request?: LockRequester } } | undefined)?.locks;
    if (locks && typeof locks.request === "function") return locks.request.bind(locks);
  } catch {
    // fall through to null — treat exactly like "Web Locks unavailable"
  }
  return null;
}

function defaultSubscribeUnload(fn: () => void): () => void {
  try {
    if (typeof window === "undefined") return () => {};
    // M3: `pagehide` only, and only fires `fn` on a genuine unload
    // (`!event.persisted`) — see this module's header. No `beforeunload`
    // here (unlike `lib/sessionMarker.ts`'s unrelated clean-shutdown flag,
    // which has its own reasons to register both).
    const onPageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) fn();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  } catch {
    return () => {}; // best-effort only — never let registration itself throw
  }
}

/** What `createBrowserLockProvider` returns — the plain `LockProvider`
 *  shape plus `dispose()` (M6): every existing `LockProvider`-typed call
 *  site (every other provider, every test) is unaffected, since this is a
 *  strict superset; only the installing effect in App.tsx reads `dispose`. */
export type BrowserLockProvider = LockProvider & { dispose: () => void };

/** The browser-tab provider. `App.tsx` installs this (dynamic import, the
 *  same lazy shape as `createDesktopLockProvider`) in the non-desktop
 *  branch — see that module's lock-provider effect. */
export function createBrowserLockProvider(instanceId: string, deps: BrowserLockDeps = {}): BrowserLockProvider {
  const storage = deps.storage ?? safeLocalStorage();
  const lockRequest = "lockRequest" in deps ? (deps.lockRequest ?? null) : defaultLockRequest();
  const subscribeUnload = deps.subscribeUnload ?? defaultSubscribeUnload;
  const yieldForTest = deps.yieldForTest;

  let tokenSeq = 0;
  // M5: reuse `lib/lockState.ts`'s own `acquire()` for the shared
  // instanceId/acquiredAt/heartbeatAt shape — the SAME helper
  // `store/inMemoryLockProvider.ts`'s `mintRecord` uses, rather than a
  // second hand-rolled copy of what a fresh record looks like.
  const mintRecord = (): LockRecord & { token: string } => ({
    ...acquire(instanceId, Date.now()),
    token: `browser-${instanceId}-${++tokenSeq}`,
  });

  /** Paths this instance currently believes it holds, for the best-effort
   *  unload release below — never itself consulted for a CAS decision. */
  const heldPaths = new Map<string, string>();

  function readEnvelope(path: string): { record: LockRecord | null; unverifiable: boolean } {
    if (storage === undefined) return { record: null, unverifiable: true };
    let raw: string | null;
    try {
      raw = storage.getItem(storageKey(path));
    } catch {
      return { record: null, unverifiable: true };
    }
    return parseEnvelope(raw);
  }

  function writeEnvelope(path: string, record: LockRecord): boolean {
    if (storage === undefined) return false;
    try {
      const envelope: StoredEnvelope = { v: 1, record };
      storage.setItem(storageKey(path), JSON.stringify(envelope));
      return true;
    } catch {
      return false; // e.g. quota exceeded in private browsing — fail closed
    }
  }

  function removeEnvelope(path: string): boolean {
    if (storage === undefined) return false;
    try {
      storage.removeItem(storageKey(path));
      return true;
    } catch {
      return false;
    }
  }

  /** Runs `body` — the read-decide-write critical section — under the Web
   *  Locks mutex when available, unguarded otherwise (see this module's
   *  header for exactly what guarantee each mode gives). `body` itself may
   *  `await yieldForTest()` in tests to force a real interleaving window. */
  async function withCas<T>(path: string, body: () => T | Promise<T>): Promise<T> {
    if (lockRequest === null) return body();
    try {
      return (await lockRequest(`qz-project-lock-cas:${path}`, body)) as T;
    } catch {
      // The Web Locks call itself failed (an unexpected engine error, an
      // aborted request) — degrade to running unguarded rather than hang
      // the caller forever; never throw out of a LockProvider verb.
      return body();
    }
  }

  const failUnverifiable: LockCasResult = { acquired: false, record: null, unverifiable: true };

  // Best-effort release on tab close — registered BEFORE the `return` below
  // so it actually runs (a statement after a function's `return` is dead
  // code); see this module's header, "RELEASE ON TAB CLOSE" and M2/M3/M6.
  // M2: routed through the SAME `withCas` mutex the other verbs use — when
  // Web Locks is available, this closes the read-then-act TOCTOU window a
  // bare, unguarded compare-and-delete would have against a concurrent
  // `takeOver` (see browserLockProvider.test.ts's forced-race pair for the
  // worked proof). `void`d — a pagehide handler cannot usefully await
  // anything (the page may finish tearing down regardless), so this is
  // fire-and-forget: it runs to completion when the engine gives it the
  // chance, and simply doesn't when it doesn't (the documented no-mutex-
  // style residual, M2's own "accept + document" clause). Without Web
  // Locks, `withCas` runs `body` synchronously with no `await` before the
  // compare-and-delete, same single-block guarantee as before.
  const unsubscribeUnload = subscribeUnload(() => {
    for (const [path, token] of heldPaths) {
      void withCas(path, async () => {
        const { record, unverifiable } = readEnvelope(path);
        if (unverifiable) return;
        if (yieldForTest) await yieldForTest();
        if (record !== null && record.token === token) {
          removeEnvelope(path);
        }
      });
    }
    heldPaths.clear();
  });

  return {
    dispose: () => unsubscribeUnload(),

    read: async (path) => {
      const { record, unverifiable } = readEnvelope(path);
      return unverifiable ? null : record;
    },

    tryAcquire: async (path) =>
      withCas(path, async () => {
        const now = Date.now();
        const { record: current, unverifiable } = readEnvelope(path);
        if (unverifiable) return failUnverifiable;
        const status = classifyLock(current, instanceId, now);
        if (status !== "unlocked" && status !== "held-by-me") {
          return { acquired: false, record: current };
        }
        if (yieldForTest) await yieldForTest();
        const record = mintRecord();
        if (!writeEnvelope(path, record)) return failUnverifiable;
        heldPaths.set(path, record.token);
        return { acquired: true, record };
      }),

    refresh: async (path, token) =>
      withCas(path, async () => {
        const { record: current, unverifiable } = readEnvelope(path);
        if (unverifiable) return failUnverifiable;
        if (current === null || current.token !== token) {
          return { acquired: false, record: current };
        }
        if (yieldForTest) await yieldForTest();
        const updated: LockRecord = { ...current, heartbeatAt: Date.now() };
        if (!writeEnvelope(path, updated)) return failUnverifiable;
        return { acquired: true, record: updated };
      }),

    takeOver: async (path, expectedToken) =>
      withCas(path, async () => {
        const now = Date.now();
        const { record: current, unverifiable } = readEnvelope(path);
        if (unverifiable) return failUnverifiable;
        if (current === null || current.token !== expectedToken) {
          return { acquired: false, record: current };
        }
        if (!canTakeOver(classifyLock(current, instanceId, now))) {
          return { acquired: false, record: current }; // no longer stale — refuse, don't clobber
        }
        if (yieldForTest) await yieldForTest();
        const record = mintRecord();
        if (!writeEnvelope(path, record)) return failUnverifiable;
        heldPaths.set(path, record.token);
        return { acquired: true, record };
      }),

    release: async (path, token) =>
      withCas(path, async () => {
        const { record: current, unverifiable } = readEnvelope(path);
        if (unverifiable || current === null || current.token !== token) return false;
        if (yieldForTest) await yieldForTest();
        const ok = removeEnvelope(path);
        if (ok) heldPaths.delete(path);
        return ok;
      }),
  };
}
