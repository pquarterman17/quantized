// The browser-tab LockProvider (closes the "browser multi-tab" defer named
// in plans/RELEASE_BLOCKERS.md's I2 entry). Two "tabs" are simulated as two
// `createBrowserLockProvider` instances sharing one fake `storage` object
// (a plain Map-backed stand-in for `localStorage`, so tests never depend on
// jsdom's real store or leak state between runs) — the same "two provider
// instances over one mocked backing store" shape `desktopLockProvider.test.ts`
// uses for the filesystem provider (there, a shared `window.pywebview.api`
// mock stands in for the OS lock file).
//
// The forced-race tests near the bottom follow `docs/testing.md`'s evidence
// standard (worked example: `useFigureBuilder.test.ts`'s "forces the item-22
// race"): a deferred promise injected via the provider's TEST-ONLY
// `yieldForTest` seam holds two concurrent calls open at the exact point a
// real cross-tab interleaving would land, so the race is reproduced on every
// run rather than hoped-for under real scheduling.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserLockProvider, type BrowserLockDeps, type LockRequester, type MinimalStorage } from "./browserLockProvider";
import { STALE_AFTER_MS } from "./lockState";

// ── test doubles ────────────────────────────────────────────────────────

/** A plain Map-backed `MinimalStorage` — every test gets its own instance,
 *  so no state ever leaks between tests (unlike jsdom's real `localStorage`,
 *  which persists across a whole test file unless manually cleared). */
function makeFakeStorage(): MinimalStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** A storage whose every method throws — the "quota exceeded in private
 *  browsing" / "storage access blocked" class of failure (constraint: fail
 *  closed, never throw out of a LockProvider verb). */
function makeThrowingStorage(): MinimalStorage {
  const boom = () => {
    throw new Error("storage access blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

/** A realistic per-name exclusive-lock fake: `request(name, fn)` for a given
 *  `name` only invokes `fn` after every PRIOR request for that SAME name has
 *  settled — exactly the FIFO exclusive-mode queuing `navigator.locks`
 *  provides for two real browser tabs of the same origin. */
function makeFakeLockManager(): LockRequester {
  const queues = new Map<string, Promise<unknown>>();
  return (name, fn) => {
    const prior = queues.get(name) ?? Promise.resolve();
    const run = prior.then(
      () => fn(),
      () => fn(),
    );
    queues.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Every test opts OUT of registering a real `pagehide` listener on jsdom's
 *  shared `window` by default (a no-op `subscribeUnload` returning a no-op
 *  unsubscribe) — the dedicated "release on tab close" tests below inject a
 *  capturing fake instead. Without this, every other test in this file
 *  would leak a real DOM listener onto the shared jsdom window. */
function makeTab(instanceId: string, overrides: BrowserLockDeps = {}): ReturnType<typeof createBrowserLockProvider> {
  return createBrowserLockProvider(instanceId, { subscribeUnload: () => () => {}, ...overrides });
}

const PATH = "/projects/demo.dwk";

// ── read ────────────────────────────────────────────────────────────────

describe("createBrowserLockProvider — read", () => {
  it("returns null when nothing is stored", async () => {
    const tab = makeTab("inst-a", { storage: makeFakeStorage() });
    expect(await tab.read(PATH)).toBeNull();
  });

  it("returns the record after a tab acquires", async () => {
    const storage = makeFakeStorage();
    const tab = makeTab("inst-a", { storage });
    await tab.tryAcquire(PATH);
    const record = await tab.read(PATH);
    expect(record?.instanceId).toBe("inst-a");
  });

  it("a malformed (non-JSON) record reads as null — fail-closed, never a guess", async () => {
    const storage = makeFakeStorage();
    storage.setItem("qz-project-lock:v1:" + PATH, "{not json");
    const tab = makeTab("inst-a", { storage });
    expect(await tab.read(PATH)).toBeNull();
  });

  it("a record missing required fields reads as null", async () => {
    const storage = makeFakeStorage();
    storage.setItem("qz-project-lock:v1:" + PATH, JSON.stringify({ v: 1, record: { instanceId: "x" } }));
    const tab = makeTab("inst-a", { storage });
    expect(await tab.read(PATH)).toBeNull();
  });

  it("a record from a foreign/future schema version reads as null, not 'unlocked'", async () => {
    const storage = makeFakeStorage();
    storage.setItem(
      "qz-project-lock:v1:" + PATH,
      JSON.stringify({ v: 2, record: { instanceId: "x", token: "t", acquiredAt: 1, heartbeatAt: 1 } }),
    );
    const tab = makeTab("inst-a", { storage });
    expect(await tab.read(PATH)).toBeNull();
  });

  it("a storage exception reads as null", async () => {
    const tab = makeTab("inst-a", { storage: makeThrowingStorage() });
    expect(await tab.read(PATH)).toBeNull();
  });
});

// ── mutual exclusion (tryAcquire) ──────────────────────────────────────

describe("createBrowserLockProvider — mutual exclusion", () => {
  it("a second tab's tryAcquire refuses with the first tab's record", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    const tabB = makeTab("inst-b", { storage });

    const a = await tabA.tryAcquire(PATH);
    expect(a.acquired).toBe(true);

    const b = await tabB.tryAcquire(PATH);
    expect(b.acquired).toBe(false);
    expect(b.record?.instanceId).toBe("inst-a");
    expect(b.record?.token).toBe(a.record?.token);
  });

  it("the SAME tab re-acquiring (held-by-me) succeeds directly, no takeover needed", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    await tabA.tryAcquire(PATH);
    const again = await tabA.tryAcquire(PATH);
    expect(again.acquired).toBe(true);
  });

  it("independent project paths do not contend", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    const tabB = makeTab("inst-b", { storage });
    const a = await tabA.tryAcquire(PATH);
    const b = await tabB.tryAcquire("/projects/other.dwk");
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
  });

  it("a malformed stored record refuses acquisition (unverifiable), never acquires over it", async () => {
    const storage = makeFakeStorage();
    storage.setItem("qz-project-lock:v1:" + PATH, "garbage");
    const tab = makeTab("inst-a", { storage });
    const out = await tab.tryAcquire(PATH);
    expect(out.acquired).toBe(false);
    expect(out.unverifiable).toBe(true);
  });

  it("a storage exception on write fails closed (unverifiable), does not report success", async () => {
    const storage = makeFakeStorage();
    const failingWrite: MinimalStorage = {
      ...storage,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const tab = makeTab("inst-a", { storage: failingWrite });
    const out = await tab.tryAcquire(PATH);
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });

  it("a storage exception on read fails closed", async () => {
    const tab = makeTab("inst-a", { storage: makeThrowingStorage() });
    const out = await tab.tryAcquire(PATH);
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });
});

// ── refresh CAS ─────────────────────────────────────────────────────────

describe("createBrowserLockProvider — refresh", () => {
  it("a matching token bumps the heartbeat", async () => {
    const storage = makeFakeStorage();
    const tab = makeTab("inst-a", { storage });
    const acquired = await tab.tryAcquire(PATH);
    const token = acquired.record?.token ?? "";
    const before = acquired.record?.heartbeatAt ?? 0;
    await new Promise((r) => setTimeout(r, 2));
    const refreshed = await tab.refresh(PATH, token);
    expect(refreshed.acquired).toBe(true);
    expect(refreshed.record?.heartbeatAt).toBeGreaterThanOrEqual(before);
  });

  it("a stale token loses: refresh reports the CURRENT (new) holder's record after a takeover", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    const tabB = makeTab("inst-b", { storage });
    const a = await tabA.tryAcquire(PATH);
    const staleToken = a.record?.token ?? "";

    // Force A's own record stale by rewriting its heartbeat directly in the
    // shared store (the deterministic equivalent of "time passed" — see the
    // dedicated staleness test below for the `STALE_AFTER_MS` boundary).
    const key = "qz-project-lock:v1:" + PATH;
    const raw = storage.getItem(key);
    const parsed = JSON.parse(raw as string);
    parsed.record.heartbeatAt = Date.now() - STALE_AFTER_MS - 1;
    storage.setItem(key, JSON.stringify(parsed));

    const takenOver = await tabB.takeOver(PATH, staleToken);
    expect(takenOver.acquired).toBe(true);

    const refreshResult = await tabA.refresh(PATH, staleToken);
    expect(refreshResult.acquired).toBe(false);
    expect(refreshResult.record?.instanceId).toBe("inst-b");
  });

  it("no record at all refuses refresh with record: null", async () => {
    const tab = makeTab("inst-a", { storage: makeFakeStorage() });
    const out = await tab.refresh(PATH, "some-token");
    expect(out).toEqual({ acquired: false, record: null });
  });

  it("a storage exception fails closed", async () => {
    const tab = makeTab("inst-a", { storage: makeThrowingStorage() });
    const out = await tab.refresh(PATH, "tok");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });
});

// ── takeOver CAS ────────────────────────────────────────────────────────

describe("createBrowserLockProvider — takeOver", () => {
  function forceStale(storage: MinimalStorage, path: string): void {
    const key = "qz-project-lock:v1:" + path;
    const parsed = JSON.parse(storage.getItem(key) as string);
    parsed.record.heartbeatAt = Date.now() - STALE_AFTER_MS - 1;
    storage.setItem(key, JSON.stringify(parsed));
  }

  it("succeeds against a genuinely stale lock (lib/lockState's own staleness rule)", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    const tabB = makeTab("inst-b", { storage });
    const a = await tabA.tryAcquire(PATH);
    forceStale(storage, PATH);

    const out = await tabB.takeOver(PATH, a.record?.token ?? "");
    expect(out.acquired).toBe(true);
    expect(out.record?.instanceId).toBe("inst-b");
  });

  it("refuses to take over a LIVE lock even when expectedToken matches — L0.47's hard gate", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    const tabB = makeTab("inst-b", { storage });
    const a = await tabA.tryAcquire(PATH);
    // No forceStale() here — A's heartbeat is fresh.
    const out = await tabB.takeOver(PATH, a.record?.token ?? "");
    expect(out.acquired).toBe(false);
    expect(out.record?.instanceId).toBe("inst-a");
  });

  it("refuses when expectedToken no longer matches (a third tab already took over)", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    const tabB = makeTab("inst-b", { storage });
    const tabC = makeTab("inst-c", { storage });
    const a = await tabA.tryAcquire(PATH);
    forceStale(storage, PATH);
    const b = await tabB.takeOver(PATH, a.record?.token ?? "");
    expect(b.acquired).toBe(true);

    // C still has A's now-stale token as its "expected" value — must refuse,
    // never clobber B's brand-new live lock.
    const c = await tabC.takeOver(PATH, a.record?.token ?? "");
    expect(c.acquired).toBe(false);
    expect(c.record?.instanceId).toBe("inst-b");
  });

  it("a storage exception fails closed", async () => {
    const tab = makeTab("inst-a", { storage: makeThrowingStorage() });
    const out = await tab.takeOver(PATH, "tok");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });
});

// ── release ─────────────────────────────────────────────────────────────

describe("createBrowserLockProvider — release", () => {
  it("releases the holder's own lock", async () => {
    const storage = makeFakeStorage();
    const tab = makeTab("inst-a", { storage });
    const a = await tab.tryAcquire(PATH);
    expect(await tab.release(PATH, a.record?.token ?? "")).toBe(true);
    expect(await tab.read(PATH)).toBeNull();
  });

  it("is idempotent — releasing again is a harmless false, not an error", async () => {
    const storage = makeFakeStorage();
    const tab = makeTab("inst-a", { storage });
    const a = await tab.tryAcquire(PATH);
    const token = a.record?.token ?? "";
    expect(await tab.release(PATH, token)).toBe(true);
    expect(await tab.release(PATH, token)).toBe(false);
  });

  it("a token mismatch refuses and never clobbers the real holder", async () => {
    const storage = makeFakeStorage();
    const tabA = makeTab("inst-a", { storage });
    const tabB = makeTab("inst-b", { storage });
    await tabA.tryAcquire(PATH);
    expect(await tabB.release(PATH, "not-the-real-token")).toBe(false);
    expect(await tabA.read(PATH)).not.toBeNull();
  });

  it("a storage exception fails closed to false", async () => {
    const tab = makeTab("inst-a", { storage: makeThrowingStorage() });
    expect(await tab.release(PATH, "tok")).toBe(false);
  });
});

// ── best-effort release on tab close ───────────────────────────────────

describe("createBrowserLockProvider — release on tab close", () => {
  function captureUnloadHandler(): {
    deps: Pick<BrowserLockDeps, "subscribeUnload">;
    fire: () => void;
    unsubscribeCalls: number;
  } {
    let handler: (() => void) | null = null;
    const state = { unsubscribeCalls: 0 };
    return {
      deps: {
        subscribeUnload: (fn) => {
          handler = fn;
          return () => {
            state.unsubscribeCalls++;
            handler = null;
          };
        },
      },
      fire: () => handler?.(),
      get unsubscribeCalls() {
        return state.unsubscribeCalls;
      },
    };
  }

  it("clears this instance's own lock when the captured pagehide handler fires", async () => {
    const storage = makeFakeStorage();
    const { deps, fire } = captureUnloadHandler();
    const tab = createBrowserLockProvider("inst-a", { storage, ...deps });
    await tab.tryAcquire(PATH);
    expect(await tab.read(PATH)).not.toBeNull();

    fire(); // N1: synchronous — no await needed before the record is gone
    expect(await tab.read(PATH)).toBeNull();
  });

  it("never clobbers a lock a DIFFERENT tab has since taken over (sequential — see the N1 describe block below for the synchrony proof)", async () => {
    const storage = makeFakeStorage();
    const { deps, fire } = captureUnloadHandler();
    const tabA = createBrowserLockProvider("inst-a", { storage, ...deps });
    const tabB = makeTab("inst-b", { storage });

    const a = await tabA.tryAcquire(PATH);
    const key = "qz-project-lock:v1:" + PATH;
    const parsed = JSON.parse(storage.getItem(key) as string);
    parsed.record.heartbeatAt = Date.now() - STALE_AFTER_MS - 1;
    storage.setItem(key, JSON.stringify(parsed));
    const b = await tabB.takeOver(PATH, a.record?.token ?? "");
    expect(b.acquired).toBe(true);

    fire(); // A's stale unload handler must not touch B's fresh lock
    const stillThere = await tabB.read(PATH);
    expect(stillThere?.instanceId).toBe("inst-b");
  });

  // M3 (coordinator review): `beforeunload` fires for a page merely being
  // frozen into the back/forward cache, not only a real unload, and cannot
  // tell the two apart — release must be tied to `pagehide`'s own
  // `persisted` flag instead. These three exercise the REAL
  // `defaultSubscribeUnload` (no injected fake), captured off jsdom's real
  // `window.addEventListener` via a spy, so they prove the production
  // wiring itself, not just the injectable seam.
  it("M3: does NOT release on a pagehide whose persisted flag is true (bfcache freeze, not a real unload)", async () => {
    const storage = makeFakeStorage();
    const addSpy = vi.spyOn(window, "addEventListener");
    const tab = createBrowserLockProvider("inst-a", { storage });
    const onPageHide = addSpy.mock.calls.find((c) => c[0] === "pagehide")?.[1] as unknown as (e: { persisted: boolean }) => void;
    addSpy.mockRestore();

    await tab.tryAcquire(PATH);
    expect(await tab.read(PATH)).not.toBeNull();

    onPageHide({ persisted: true });
    await Promise.resolve();
    expect(await tab.read(PATH)).not.toBeNull(); // untouched — this was a bfcache freeze, not a real unload
    tab.dispose();
  });

  it("M3: DOES release on a pagehide with persisted: false (a genuine unload)", async () => {
    const storage = makeFakeStorage();
    const addSpy = vi.spyOn(window, "addEventListener");
    const tab = createBrowserLockProvider("inst-a", { storage });
    const onPageHide = addSpy.mock.calls.find((c) => c[0] === "pagehide")?.[1] as unknown as (e: { persisted: boolean }) => void;
    addSpy.mockRestore();

    await tab.tryAcquire(PATH);
    onPageHide({ persisted: false });
    await Promise.resolve();
    expect(await tab.read(PATH)).toBeNull();
    tab.dispose();
  });

  it("M3: beforeunload is not wired to release at all", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const tab = createBrowserLockProvider("inst-a", { storage: makeFakeStorage() });
    expect(addSpy.mock.calls.some((c) => c[0] === "beforeunload")).toBe(false);
    addSpy.mockRestore();
    tab.dispose();
  });

  // M6: a remount (StrictMode double-mount, or any real unmount/remount of
  // the installing effect) must be able to remove exactly the listener IT
  // registered, not leak a second permanent one.
  it("M6: dispose() unsubscribes — the captured pagehide handler no longer fires after dispose", async () => {
    const storage = makeFakeStorage();
    // `unsubscribeCalls` is a GETTER on the returned object — read it off
    // the object itself (not destructured into a local, which would
    // snapshot the value at destructure time, before dispose() ever runs).
    const handle = captureUnloadHandler();
    const tab = createBrowserLockProvider("inst-a", { storage, ...handle.deps });
    await tab.tryAcquire(PATH);

    tab.dispose();
    expect(handle.unsubscribeCalls).toBe(1);

    handle.fire(); // the handler was cleared by the fake's own unsubscribe — a no-op
    await Promise.resolve();
    expect(await tab.read(PATH)).not.toBeNull(); // never released — dispose real-unsubscribed it first
  });
});

// ── N1: unload release is synchronous (regression revert) ──────────────
//
// M2 (round 2) routed the pagehide release through the Web Locks mutex to
// close a TOCTOU window against a concurrent `takeOver`. That was a real
// regression: `navigator.locks.request`'s callback is ALWAYS asynchronous,
// even when the lock is immediately free, and a dying document gives no
// guarantee any pending microtask still runs — on `localhost` (always a
// secure context, Web Locks always present) this meant the release
// silently never completed on an ordinary close. N1 reverts to a single
// synchronous compare-and-delete; the tests below prove exactly that.

describe("createBrowserLockProvider — unload release is synchronous (N1)", () => {
  function captureHandler(): { deps: Pick<BrowserLockDeps, "subscribeUnload">; fire: () => void } {
    let handler: (() => void) | null = null;
    return {
      deps: { subscribeUnload: (fn) => ((handler = fn), () => (handler = null)) },
      fire: () => handler?.(),
    };
  }

  it("N1: completes the removal SYNCHRONOUSLY on pagehide — no pending promise needed (regression guard)", async () => {
    const storage = makeFakeStorage();
    const { deps, fire } = captureHandler();
    const tab = createBrowserLockProvider("inst-a", { storage, ...deps });
    await tab.tryAcquire(PATH);
    const key = "qz-project-lock:v1:" + PATH;
    expect(storage.getItem(key)).not.toBeNull();

    fire();

    // NO `await` of any kind between `fire()` and this assertion — proves
    // the removal happened in the SAME synchronous tick as the pagehide
    // callback, exactly what a real dying document requires. An `async`
    // (Web-Locks-mutexed) release would still show the record present here,
    // since `navigator.locks.request`'s callback needs at least one
    // microtask turn to even start running.
    expect(storage.getItem(key)).toBeNull();
  });

  it("N1: even when Web Locks IS configured, the unload path never uses it — synchronous either way", async () => {
    const storage = makeFakeStorage();
    const { deps, fire } = captureHandler();
    // A lockRequest that would prove itself used by resolving asynchronously
    // (a real `navigator.locks.request` always does) — if the unload path
    // routed through it, the removal could not possibly be synchronous.
    const asyncLockRequest: LockRequester = async (_name, fn) => {
      await Promise.resolve();
      return fn();
    };
    const tab = createBrowserLockProvider("inst-a", { storage, lockRequest: asyncLockRequest, ...deps });
    await tab.tryAcquire(PATH);
    const key = "qz-project-lock:v1:" + PATH;

    fire();

    expect(storage.getItem(key)).toBeNull(); // still synchronous — the unload path ignores lockRequest entirely
  });

  it("N1: the accepted residual — a release racing a takeover with no forced interleave still completes without throwing", async () => {
    // Not a forced race (there is nothing left to force: the release has no
    // await point to interleave at anymore) — just confirms the reverted
    // synchronous path is well-behaved sequentially, the shape a real
    // concurrent takeover would actually take (see this describe block's
    // header for why the TOCTOU itself is now an accepted, documented
    // residual rather than something this module tries to close).
    const storage = makeFakeStorage();
    const { deps, fire } = captureHandler();
    const tabA = createBrowserLockProvider("inst-a", { storage, ...deps });
    const tabB = makeTab("inst-b", { storage });
    const a = await tabA.tryAcquire(PATH);
    const key = "qz-project-lock:v1:" + PATH;
    const parsed = JSON.parse(storage.getItem(key) as string);
    parsed.record.heartbeatAt = Date.now() - STALE_AFTER_MS - 1;
    storage.setItem(key, JSON.stringify(parsed));
    const b = await tabB.takeOver(PATH, a.record?.token ?? "");
    expect(b.acquired).toBe(true);

    fire(); // A's release: current record is now B's — token mismatch, no-op
    expect(await tabB.read(PATH)).not.toBeNull();
  });
});

// ── forced races (docs/testing.md evidence standard) ───────────────────

describe("createBrowserLockProvider — forced concurrent-acquire race", () => {
  afterEach(() => {
    // no fake timers used in this block; nothing to restore, kept for
    // symmetry with the rest of the suite's afterEach conventions.
  });

  it("forces the no-mutex race: two tabs whose critical sections interleave can BOTH acquire — the documented fallback risk, made concrete", async () => {
    const storage = makeFakeStorage();
    const gate = deferred<void>();
    const tabA = makeTab("inst-a", { storage, lockRequest: null, yieldForTest: () => gate.promise });
    const tabB = makeTab("inst-b", { storage, lockRequest: null, yieldForTest: () => gate.promise });

    // Both calls run their read+classify synchronously and suspend at the
    // SAME await point (`yieldForTest`) before either has written — the
    // exact cross-process interleaving window a real pair of browser tabs
    // could hit without a mutex. Both are provably still "unlocked" here.
    const p1 = tabA.tryAcquire(PATH);
    const p2 = tabB.tryAcquire(PATH);

    gate.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.acquired).toBe(true);
    expect(r2.acquired).toBe(true); // split-brain: the race this test forces into the open
    expect(r1.record?.token).not.toBe(r2.record?.token);
  });

  it("the Web Locks mutex closes that exact window: the same forced interleave now yields exactly one winner", async () => {
    const storage = makeFakeStorage();
    const lockRequest = makeFakeLockManager();
    const gate = deferred<void>();
    const tabA = makeTab("inst-a", { storage, lockRequest, yieldForTest: () => gate.promise });
    const tabB = makeTab("inst-b", { storage, lockRequest, yieldForTest: () => gate.promise });

    const p1 = tabA.tryAcquire(PATH);
    const p2 = tabB.tryAcquire(PATH);
    gate.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);

    const results = [r1, r2];
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toHaveLength(1);
  });

  it("a Web Locks request that itself throws degrades to unguarded rather than hanging or throwing", async () => {
    const storage = makeFakeStorage();
    const throwingLockRequest: LockRequester = () => {
      throw new Error("locks API misbehaving");
    };
    const tab = makeTab("inst-a", { storage, lockRequest: throwingLockRequest });
    const out = await tab.tryAcquire(PATH);
    expect(out.acquired).toBe(true); // degraded to the unguarded body, not a hang/throw
  });
});
