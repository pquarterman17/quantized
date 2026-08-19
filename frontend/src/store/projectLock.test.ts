// Red-first store tests for PR I2 (LIBRARY_WORKBOOK_UX_PLAN L0.47) —
// single-writer project locking. A fake, fully-controllable `LockProvider`
// stands in for "another running Quantized process" by writing/removing
// records directly, independent of anything `useProjectLock`'s own actions
// do — exactly the seam the real (booked) filesystem provider will fill.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { STALE_AFTER_MS, type LockRecord } from "../lib/lockState";
import { useApp } from "./useApp";
import { useProjectLock, type LockProvider } from "./projectLock";

function fakeProvider(): LockProvider & { store: Map<string, LockRecord> } {
  const store = new Map<string, LockRecord>();
  return {
    store,
    read: async (path) => store.get(path) ?? null,
    write: async (path, record) => {
      store.set(path, record);
      return true;
    },
    clear: async (path) => {
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
    const { store, instanceId } = { ...useProjectLock.getState().provider, instanceId: "other-instance" } as unknown as {
      store: Map<string, LockRecord>;
      instanceId: string;
    };
    store.set(PATH, { instanceId: "other-live", acquiredAt: Date.now(), heartbeatAt: Date.now() });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result).toEqual({ status: "held-by-other-live", readOnly: true });
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
    void instanceId;
  });

  it("opens read-only with Take Over Editing available when the OTHER instance's lock is stale", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    provider.store.set(PATH, {
      instanceId: "other-dead",
      acquiredAt: Date.now() - STALE_AFTER_MS - 100_000,
      heartbeatAt: Date.now() - STALE_AFTER_MS - 1_000,
    });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result).toEqual({ status: "held-by-other-stale", readOnly: true });
  });

  it("never overwrites another live holder's record on open", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    const original: LockRecord = { instanceId: "other-live", acquiredAt: 1, heartbeatAt: Date.now() };
    provider.store.set(PATH, original);
    await useProjectLock.getState().openProject(PATH);
    expect(provider.store.get(PATH)).toEqual(original);
  });
});

describe("takeOverEditing", () => {
  async function seedStale(): Promise<ReturnType<typeof fakeProvider>> {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    provider.store.set(PATH, {
      instanceId: "other-dead",
      acquiredAt: Date.now() - STALE_AFTER_MS - 100_000,
      heartbeatAt: Date.now() - STALE_AFTER_MS - 1_000,
    });
    await useProjectLock.getState().openProject(PATH);
    return provider;
  }

  it("succeeds against a stale lock and becomes held-by-me", async () => {
    const provider = await seedStale();
    const ok = await useProjectLock.getState().takeOverEditing();
    expect(ok).toBe(true);
    const s = useProjectLock.getState();
    expect(s.status).toBe("held-by-me");
    expect(provider.store.get(PATH)?.instanceId).toBe(s.instanceId);
  });

  it("refuses when the (re-verified) lock is actually LIVE, even if the UI's last-seen status said stale", async () => {
    const provider = await seedStale();
    // TOCTOU: the "dead" holder actually heartbeats again between openProject
    // and the user clicking Take Over Editing.
    provider.store.set(PATH, { instanceId: "other-dead", acquiredAt: 1, heartbeatAt: Date.now() });
    const ok = await useProjectLock.getState().takeOverEditing();
    expect(ok).toBe(false);
    expect(useProjectLock.getState().status).toBe("held-by-other-live");
    expect(provider.store.get(PATH)?.instanceId).toBe("other-dead"); // untouched
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

  it("demotes to read-only when another instance has taken over underneath this one", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    await useProjectLock.getState().openProject(PATH);
    // Simulate a takeover from an outside process — direct provider write,
    // bypassing this store's own actions entirely.
    provider.store.set(PATH, { instanceId: "intruder", acquiredAt: Date.now(), heartbeatAt: Date.now() });
    const ok = await useProjectLock.getState().heartbeat();
    expect(ok).toBe(false);
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
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
    provider.store.set(PATH, { instanceId: "someone-else", acquiredAt: 1, heartbeatAt: Date.now() });
    useProjectLock.setState({ path: PATH, status: "held-by-other-live", record: provider.store.get(PATH)! });
    await useProjectLock.getState().releaseLock();
    expect(provider.store.has(PATH)).toBe(true); // untouched
  });
});

describe("openAsCopy", () => {
  it("clears useApp's currentProject and marks the session writable, without touching the original lock", async () => {
    const provider = useProjectLock.getState().provider as ReturnType<typeof fakeProvider>;
    provider.store.set(PATH, { instanceId: "other-live", acquiredAt: 1, heartbeatAt: Date.now() });
    await useProjectLock.getState().openProject(PATH);
    useApp.setState({ currentProject: { name: "demo.dwk", path: PATH } });

    useProjectLock.getState().openAsCopy();

    expect(useApp.getState().currentProject).toBeNull();
    expect(useProjectLock.getState().canWriteNow()).toBe(true);
    expect(provider.store.get(PATH)?.instanceId).toBe("other-live"); // original holder unaffected
  });
});

describe("provider failure handling — never guess writable", () => {
  it("a read failure on open reports read-only rather than acquiring", async () => {
    useProjectLock.setState({
      provider: {
        read: vi.fn(async () => {
          throw new Error("disk error");
        }),
        write: vi.fn(async () => true),
        clear: vi.fn(async () => true),
      },
    });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result.readOnly).toBe(true);
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
  });

  it("a write failure on acquire reports read-only rather than claiming ownership", async () => {
    useProjectLock.setState({
      provider: {
        read: vi.fn(async () => null),
        write: vi.fn(async () => false),
        clear: vi.fn(async () => true),
      },
    });
    const result = await useProjectLock.getState().openProject(PATH);
    expect(result.readOnly).toBe(true);
  });
});
