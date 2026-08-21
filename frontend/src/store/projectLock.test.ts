// Red-first store tests for PR I2 (LIBRARY_WORKBOOK_UX_PLAN L0.47) —
// single-writer project locking. A fake, fully-controllable `LockProvider`
// stands in for "another running Quantized process" by writing/removing
// records directly, independent of anything `useProjectLock`'s own actions
// do — exactly the seam the real (now-landed, I2 audit fix P0-3/P1-1)
// filesystem provider fills, and the ATOMIC-VERB contract every provider
// (in-memory, filesystem, or a test fake) must honor: `tryAcquire`/
// `refresh`/`takeOver` are each a SINGLE call that performs its own
// compare-and-swap — no test here composes a mutation out of a separate
// `read` followed by an unconditional write, and neither may production
// code (see the "mutation only via verbs" describe block at the bottom).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { STALE_AFTER_MS, type LockRecord } from "../lib/lockState";
import { useApp } from "./useApp";
import {
  createInMemoryLockProvider,
  useProjectLock,
  type LockCasResult,
  type LockProvider,
} from "./projectLock";

let tokenSeq = 0;

function withToken(record: Omit<LockRecord, "token">): LockRecord {
  return { ...record, token: `test-token-${++tokenSeq}` };
}

/** A fully-atomic fake — mirrors the real in-memory provider's own CAS
 *  shape (single-turn read-compare-write, no gap) so every test below
 *  exercises the SAME race-freedom the real providers guarantee, not a
 *  weaker stand-in. `store` is exposed for tests that need to simulate an
 *  OUTSIDE process/instance mutating the record directly (bypassing every
 *  action on `useProjectLock` entirely). */
function fakeProvider(): LockProvider & { store: Map<string, LockRecord> } {
  const store = new Map<string, LockRecord>();
  return {
    store,
    read: async (path) => store.get(path) ?? null,
    // `useProjectLock`'s own `openProject` already classifies the CURRENT
    // record before ever calling `tryAcquire` (never reaching it for a
    // live other holder), so this fake always honors whatever the caller
    // decided by reaching this verb at all — matching the real in-memory
    // provider's own division of labor.
    tryAcquire: async (path) => {
      const record = withToken({ instanceId: useProjectLock.getState().instanceId, acquiredAt: Date.now(), heartbeatAt: Date.now() });
      store.set(path, record);
      return { acquired: true, record };
    },
    refresh: async (path, token) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== token) return { acquired: false, record: current };
      const updated = { ...current, heartbeatAt: Date.now() };
      store.set(path, updated);
      return { acquired: true, record: updated };
    },
    takeOver: async (path, expectedToken) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== expectedToken) return { acquired: false, record: current };
      const record = withToken({ instanceId: useProjectLock.getState().instanceId, acquiredAt: Date.now(), heartbeatAt: Date.now() });
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

const PATH = "/projects/demo.dwk";

beforeEach(() => {
  useProjectLock.setState({
    status: "unlocked",
    record: null,
    path: null,
    openedAsCopy: false,
    provider: fakeProvider(),
  });
  useApp.setState({ currentProject: null, projectDirty: false });
});

describe("openProject", () => {
  it("acquires directly on an unlocked project", async () => {
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result).toEqual({ status: "held-by-me", readOnly: false });
    const s = useProjectLock.getState();
    expect(s.record?.instanceId).toBe(s.instanceId);
    expect((await s.provider.read(PATH))?.instanceId).toBe(s.instanceId);
  });

  it("re-acquiring a project THIS instance already holds stays held-by-me (re-entrant)", async () => {
    await useProjectLock.getState().openProject(PATH);
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result).toEqual({ status: "held-by-me", readOnly: false });
  });

  it("opens read-only, offering Open as Copy, when another LIVE instance holds it", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    provider.store.set(PATH, withToken({ instanceId: "other-live", acquiredAt: Date.now(), heartbeatAt: Date.now() }));
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result).toEqual({ status: "held-by-other-live", readOnly: true });
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
  });

  it("opens read-only with Take Over Editing available when the OTHER instance's lock is stale", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    provider.store.set(
      PATH,
      withToken({
        instanceId: "other-dead",
        acquiredAt: Date.now() - STALE_AFTER_MS - 100_000,
        heartbeatAt: Date.now() - STALE_AFTER_MS - 1_000,
      }),
    );
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result).toEqual({ status: "held-by-other-stale", readOnly: true });
  });

  it("never overwrites another live holder's record on open", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    const original = withToken({ instanceId: "other-live", acquiredAt: 1, heartbeatAt: Date.now() });
    provider.store.set(PATH, original);
    await useProjectLock.getState().openProject(PATH);
    expect(provider.store.get(PATH)).toEqual(original);
  });
});

describe("takeOverEditing", () => {
  async function seedStale(): Promise<ReturnType<typeof fakeProvider>> {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    provider.store.set(
      PATH,
      withToken({
        instanceId: "other-dead",
        acquiredAt: Date.now() - STALE_AFTER_MS - 100_000,
        heartbeatAt: Date.now() - STALE_AFTER_MS - 1_000,
      }),
    );
    await useProjectLock.getState().openProject(PATH);
    return provider;
  }

  it("succeeds against a stale lock, becomes held-by-me, and mints a FRESH token", async () => {
    const provider = await seedStale();
    const staleToken = (await provider.read(PATH))?.token;
    const ok = await useProjectLock.getState().takeOverEditing();
    expect(ok).toBe(true);
    const s = useProjectLock.getState();
    expect(s.status).toBe("held-by-me");
    expect(provider.store.get(PATH)?.instanceId).toBe(s.instanceId);
    expect(provider.store.get(PATH)?.token).not.toBe(staleToken); // never reuses the prior token
  });

  it("refuses via the provider's own CAS when a THIRD instance already took over between reads", async () => {
    // TOCTOU: after openProject's read classified "other-dead" as stale,
    // an OUTSIDE process (not `useProjectLock`) takes over first — a
    // direct provider mutation, bypassing every store action, giving the
    // record a token this session never observed.
    const provider = await seedStale();
    const intruderRecord = withToken({ instanceId: "intruder", acquiredAt: Date.now(), heartbeatAt: Date.now() });
    provider.store.set(PATH, intruderRecord);

    const ok = await useProjectLock.getState().takeOverEditing();

    expect(ok).toBe(false);
    expect(useProjectLock.getState().status).toBe("held-by-other-live");
    expect(provider.store.get(PATH)).toEqual(intruderRecord); // untouched by the refused takeover
  });

  it("refuses outright when the project was never opened in a takeover-eligible state", async () => {
    await useProjectLock.getState().openProject(PATH); // acquires directly -> held-by-me
    const ok = await useProjectLock.getState().takeOverEditing();
    expect(ok).toBe(false);
  });
});

describe("heartbeat — the false-positive safety net in the store", () => {
  it("extends this instance's own lock in the provider", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    await useProjectLock.getState().openProject(PATH);
    const before = provider.store.get(PATH)!.heartbeatAt;
    await new Promise((r) => setTimeout(r, 2));
    const ok = await useProjectLock.getState().heartbeat();
    expect(ok).toBe(true);
    expect(provider.store.get(PATH)!.heartbeatAt).toBeGreaterThanOrEqual(before);
  });

  it("keeps the SAME token across a heartbeat refresh (refresh never mints a new one)", async () => {
    await useProjectLock.getState().openProject(PATH);
    const before = useProjectLock.getState().record?.token;
    await useProjectLock.getState().heartbeat();
    expect(useProjectLock.getState().record?.token).toBe(before);
  });

  it("demotes to read-only when another instance has taken over underneath this one (token mismatch)", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    await useProjectLock.getState().openProject(PATH);
    // Simulate a takeover from an outside process — direct provider write,
    // bypassing this store's own actions entirely, so this instance's
    // cached token no longer matches what's on record.
    provider.store.set(PATH, withToken({ instanceId: "intruder", acquiredAt: Date.now(), heartbeatAt: Date.now() }));
    const ok = await useProjectLock.getState().heartbeat();
    expect(ok).toBe(false);
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
    expect(useProjectLock.getState().status).toBe("held-by-other-live");
  });
});

describe("releaseLock", () => {
  it("clears this instance's own lock", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    await useProjectLock.getState().openProject(PATH);
    await useProjectLock.getState().releaseLock();
    expect(useProjectLock.getState().status).toBe("unlocked");
    expect(provider.store.has(PATH)).toBe(false);
  });

  it("is a no-op when this instance isn't the holder", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    const other = withToken({ instanceId: "someone-else", acquiredAt: 1, heartbeatAt: Date.now() });
    provider.store.set(PATH, other);
    useProjectLock.setState({ path: PATH, status: "held-by-other-live", record: other });
    await useProjectLock.getState().releaseLock();
    expect(provider.store.has(PATH)).toBe(true); // untouched
  });
});

describe("openAsCopy", () => {
  it("clears useApp's currentProject and marks the session writable, without touching the original lock", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    const other = withToken({ instanceId: "other-live", acquiredAt: 1, heartbeatAt: Date.now() });
    provider.store.set(PATH, other);
    await useProjectLock.getState().openProject(PATH);
    useApp.setState({ currentProject: { name: "demo.dwk", path: PATH } });

    useProjectLock.getState().openAsCopy();

    expect(useApp.getState().currentProject).toBeNull();
    expect(useProjectLock.getState().canWriteNow()).toBe(true);
    expect(provider.store.get(PATH)).toEqual(other); // original holder unaffected
  });
});

describe("provider failure handling — never guess writable", () => {
  it("a read failure on open reports read-only rather than acquiring", async () => {
    useProjectLock.setState({
      provider: {
        read: vi.fn(async () => {
          throw new Error("disk error");
        }),
        tryAcquire: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        refresh: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        takeOver: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        release: vi.fn(async () => true),
      },
    });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result.readOnly).toBe(true);
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
  });

  it("a tryAcquire failure/exception reports read-only rather than claiming ownership", async () => {
    useProjectLock.setState({
      provider: {
        read: vi.fn(async () => null),
        tryAcquire: vi.fn(async () => {
          throw new Error("write denied");
        }),
        refresh: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        takeOver: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        release: vi.fn(async () => true),
      },
    });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result.readOnly).toBe(true);
  });

  it("an UNVERIFIABLE refusal reports held-by-other-live, never unlocked (fail-closed, not a guess)", async () => {
    // A corrupt/unparseable lock file resolves `record: null` too — the
    // exact same shape as "no lock exists at all". Without checking
    // `unverifiable` first, `classifyLock(null, ...)` would misreport this
    // as "unlocked" and let the session believe it's writable.
    useProjectLock.setState({
      provider: {
        read: vi.fn(async () => null),
        tryAcquire: vi.fn(async (): Promise<LockCasResult> => ({ acquired: false, record: null, unverifiable: true })),
        refresh: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        takeOver: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        release: vi.fn(async () => true),
      },
    });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result.status).toBe("held-by-other-live");
    expect(result.readOnly).toBe(true);
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
  });

  it("a tryAcquire that resolves acquired:false (lost a race) reports the CURRENT record's status, never held-by-me", async () => {
    const other = withToken({ instanceId: "winner", acquiredAt: Date.now(), heartbeatAt: Date.now() });
    useProjectLock.setState({
      provider: {
        read: vi.fn(async () => null), // looked unlocked at read time...
        tryAcquire: vi.fn(async (): Promise<LockCasResult> => ({ acquired: false, record: other })), // ...but lost the race
        refresh: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        takeOver: vi.fn(async (): Promise<LockCasResult> => ({ acquired: true, record: null })),
        release: vi.fn(async () => true),
      },
    });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result.status).toBe("held-by-other-live");
    expect(useProjectLock.getState().status).not.toBe("held-by-me");
  });
});

// I2 (P0-3/P1-1): the frontend half of "mutation goes only through atomic
// verbs" — no store action here may compose a mutation out of a bare
// `read` followed by a SEPARATE, unconditional write call. If a raw
// unconditional-write escape hatch ever creeps back onto `LockProvider`,
// these specs would need it on the fake below to even compile; their real
// job is documentation-as-a-test that every mutating store action reaches
// for `tryAcquire`/`refresh`/`takeOver`/`release` and NOTHING else.
describe("mutation goes only through atomic verbs", () => {
  it("openProject calls tryAcquire, never a bare read-then-write composition", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    const acquireSpy = vi.spyOn(provider, "tryAcquire");
    await useProjectLock.getState().openProject(PATH);
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(acquireSpy).toHaveBeenCalledWith(PATH);
  });

  it("takeOverEditing calls takeOver with the held record's token, not a re-minted acquire", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    provider.store.set(
      PATH,
      withToken({
        instanceId: "other-dead",
        acquiredAt: Date.now() - STALE_AFTER_MS - 100_000,
        heartbeatAt: Date.now() - STALE_AFTER_MS - 1_000,
      }),
    );
    await useProjectLock.getState().openProject(PATH);
    const staleToken = useProjectLock.getState().record?.token;
    const takeOverSpy = vi.spyOn(provider, "takeOver");
    await useProjectLock.getState().takeOverEditing();
    expect(takeOverSpy).toHaveBeenCalledWith(PATH, staleToken);
  });

  it("heartbeat calls refresh with the held token, never tryAcquire", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    await useProjectLock.getState().openProject(PATH);
    const token = useProjectLock.getState().record?.token;
    const refreshSpy = vi.spyOn(provider, "refresh");
    const acquireSpy = vi.spyOn(provider, "tryAcquire");
    await useProjectLock.getState().heartbeat();
    expect(refreshSpy).toHaveBeenCalledWith(PATH, token);
    expect(acquireSpy).not.toHaveBeenCalled();
  });

  it("releaseLock calls release with the held token", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    await useProjectLock.getState().openProject(PATH);
    const token = useProjectLock.getState().record?.token;
    const releaseSpy = vi.spyOn(provider, "release");
    await useProjectLock.getState().releaseLock();
    expect(releaseSpy).toHaveBeenCalledWith(PATH, token);
  });
});

// I2 (P0-3/P1-1): the REAL default provider's own atomic-verb contract —
// every other describe block above swaps in a hand-written `fakeProvider`
// for full control, so this is the direct proof `createInMemoryLockProvider`
// itself (what a browser tab and every untouched test actually run) honors
// the SAME CAS shape, not just the fake standing in for it.
describe("createInMemoryLockProvider — the real default provider's own CAS contract", () => {
  const A = "instance-a";
  const B = "instance-b";

  it("tryAcquire succeeds on an unlocked path and mints a token", async () => {
    const provider = createInMemoryLockProvider(A);
    const out = await provider.tryAcquire(PATH);
    expect(out.acquired).toBe(true);
    expect(out.record?.instanceId).toBe(A);
    expect(out.record?.token).toBeTruthy();
  });

  it("tryAcquire is re-entrant for the SAME instance (held-by-me) but mints a fresh token", async () => {
    const provider = createInMemoryLockProvider(A);
    const first = await provider.tryAcquire(PATH);
    const second = await provider.tryAcquire(PATH);
    expect(second.acquired).toBe(true);
    expect(second.record?.token).not.toBe(first.record?.token);
  });

  // NOTE on scope: `createInMemoryLockProvider(instanceId)` bakes ONE
  // identity into its own private Map at creation — exactly how
  // `store/projectLock.ts` actually uses it (one provider, one
  // `INSTANCE_ID`, per browser tab). A genuine "a DIFFERENT instance
  // freshly holds this path" scenario therefore never arises from a
  // SINGLE in-memory provider instance in real usage; that scenario is
  // covered above (the `fakeProvider`-based describe blocks, whose
  // exposed `.store` map is what lets a test simulate a foreign write).
  // This block only covers what the real default provider's OWN identity
  // can do to its OWN records.

  it("refresh succeeds for the current token and bumps heartbeatAt", async () => {
    const provider = createInMemoryLockProvider(A);
    const acquired = await provider.tryAcquire(PATH);
    const token = acquired.record!.token!;
    await new Promise((r) => setTimeout(r, 2));
    const refreshed = await provider.refresh(PATH, token);
    expect(refreshed.acquired).toBe(true);
    expect(refreshed.record!.heartbeatAt).toBeGreaterThanOrEqual(acquired.record!.heartbeatAt);
    expect(refreshed.record!.token).toBe(token); // refresh never mints a new token
  });

  it("refresh refuses a wrong token without mutating the record", async () => {
    const provider = createInMemoryLockProvider(A);
    const acquired = await provider.tryAcquire(PATH);
    const refreshed = await provider.refresh(PATH, "not-the-real-token");
    expect(refreshed.acquired).toBe(false);
    expect(refreshed.record).toEqual(acquired.record); // untouched
  });

  it("takeOver refuses when the target is not actually stale, even with the correct token", async () => {
    const provider = createInMemoryLockProvider(A);
    const acquired = await provider.tryAcquire(PATH); // fresh, held-by-me from A's perspective
    const takenOver = await provider.takeOver(PATH, acquired.record!.token!);
    // A's own fresh lock is "held-by-me" from A, not "held-by-other-stale" —
    // canTakeOver requires the LATTER, so this must refuse even with the
    // right token (a caller must never take over its own live lock this way).
    expect(takenOver.acquired).toBe(false);
  });

  it("takeOver against a path with no record at all refuses cleanly (nothing to take over)", async () => {
    const provider = createInMemoryLockProvider(B);
    const result = await provider.takeOver(PATH, "some-token-that-cant-possibly-match");
    expect(result.acquired).toBe(false);
    expect(result.record).toBeNull();
  });

  // The genuinely-stale-record takeOver path (mints a new identity+token,
  // gated by `canTakeOver`) is exercised end-to-end via the store's
  // `takeOverEditing` describe block above, using `fakeProvider` — the one
  // place staleness (a manufactured old `heartbeatAt`) is naturally
  // reachable, since this provider always mints its OWN records with a
  // fresh, current timestamp.

  it("release verifies the token before deleting", async () => {
    const provider = createInMemoryLockProvider(A);
    const acquired = await provider.tryAcquire(PATH);
    const badRelease = await provider.release(PATH, "wrong-token");
    expect(badRelease).toBe(false);
    expect(await provider.read(PATH)).toEqual(acquired.record); // untouched
    const goodRelease = await provider.release(PATH, acquired.record!.token!);
    expect(goodRelease).toBe(true);
    expect(await provider.read(PATH)).toBeNull();
  });

  it("release on a path with no record is a no-op false, never throws", async () => {
    const provider = createInMemoryLockProvider(A);
    expect(await provider.release(PATH, "anything")).toBe(false);
  });
});
