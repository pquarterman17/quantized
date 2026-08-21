// PR I2's filesystem project lock (P0-3/P1-1) — raw wire calls onto
// `quantized/desktop_bridge.py`'s `project_lock_*` js_api methods. Split
// out of desktopBridge.test.ts alongside the module itself once
// `desktopBridge.ts` neared the repo's general 500-line `.ts` ceiling
// (architecture.test.ts's RSM_CUTS_PLAN #20 guard).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireProjectLock,
  readProjectLock,
  refreshProjectLock,
  releaseProjectLock,
  takeOverProjectLock,
} from "./desktopLockBridge";

interface FakeApi {
  project_lock_acquire?: (path: string) => Promise<Record<string, unknown>>;
  project_lock_read?: (path: string) => Promise<Record<string, unknown>>;
  project_lock_refresh?: (path: string, token: string) => Promise<Record<string, unknown>>;
  project_lock_takeover?: (path: string, expectedToken: string) => Promise<Record<string, unknown>>;
  project_lock_release?: (path: string, token: string) => Promise<Record<string, unknown>>;
}

function setShell(api: FakeApi | null): void {
  const g = globalThis as { pywebview?: { api?: FakeApi } };
  if (api === null) delete g.pywebview;
  else g.pywebview = { api };
}

beforeEach(() => setShell(null));
afterEach(() => setShell(null));

const wireRecord = {
  token: "tok-1",
  instanceId: "inst-1",
  hostname: "box",
  pid: 4242,
  acquiredAt: 1000,
  heartbeatAt: 1000,
};

describe("acquireProjectLock", () => {
  it("returns null with no bridge", async () => {
    expect(await acquireProjectLock("/p/w.dwk")).toBeNull();
  });

  it("parses a successful acquisition", async () => {
    setShell({ project_lock_acquire: async () => ({ acquired: true, record: wireRecord }) });
    const out = await acquireProjectLock("/p/w.dwk");
    expect(out).toEqual({ ok: true, record: wireRecord, unverifiable: false });
  });

  it("reports a refusal with the CURRENT (other) record", async () => {
    setShell({ project_lock_acquire: async () => ({ acquired: false, record: wireRecord }) });
    const out = await acquireProjectLock("/p/w.dwk");
    expect(out?.ok).toBe(false);
    expect(out?.record).toEqual(wireRecord);
  });

  it("surfaces unverifiable rather than guessing", async () => {
    setShell({ project_lock_acquire: async () => ({ acquired: false, unverifiable: true, error: "corrupt" }) });
    const out = await acquireProjectLock("/p/w.dwk");
    expect(out?.unverifiable).toBe(true);
    expect(out?.record).toBeNull();
  });

  it("never throws — a bridge exception is reported as no bridge", async () => {
    setShell({
      project_lock_acquire: async () => {
        throw new Error("boom");
      },
    });
    expect(await acquireProjectLock("/p/w.dwk")).toBeNull();
  });
});

describe("readProjectLock", () => {
  it("returns null with no bridge", async () => {
    expect(await readProjectLock("/p/w.dwk")).toBeNull();
  });

  it("reports no record for an unlocked path, with ok always false", async () => {
    setShell({ project_lock_read: async () => ({ acquired: null, record: null }) });
    const out = await readProjectLock("/p/w.dwk");
    expect(out).toEqual({ ok: false, record: null, unverifiable: false });
  });

  it("reports the current holder with no side effect", async () => {
    setShell({ project_lock_read: async () => ({ acquired: null, record: wireRecord }) });
    const out = await readProjectLock("/p/w.dwk");
    expect(out?.record).toEqual(wireRecord);
  });
});

describe("refreshProjectLock", () => {
  it("returns null with no bridge", async () => {
    expect(await refreshProjectLock("/p/w.dwk", "tok")).toBeNull();
  });

  it("reports a successful heartbeat", async () => {
    setShell({ project_lock_refresh: async () => ({ refreshed: true, record: wireRecord }) });
    const out = await refreshProjectLock("/p/w.dwk", "tok-1");
    expect(out).toEqual({ ok: true, record: wireRecord, unverifiable: false });
  });

  it("reports a token-mismatch refusal", async () => {
    const other = { ...wireRecord, token: "someone-else" };
    setShell({ project_lock_refresh: async () => ({ refreshed: false, record: other }) });
    const out = await refreshProjectLock("/p/w.dwk", "tok-1");
    expect(out?.ok).toBe(false);
    expect(out?.record).toEqual(other);
  });
});

describe("takeOverProjectLock", () => {
  it("returns null with no bridge", async () => {
    expect(await takeOverProjectLock("/p/w.dwk", "expected")).toBeNull();
  });

  it("reports a successful takeover with a fresh record", async () => {
    setShell({ project_lock_takeover: async () => ({ acquired: true, record: wireRecord }) });
    const out = await takeOverProjectLock("/p/w.dwk", "expected");
    expect(out).toEqual({ ok: true, record: wireRecord, unverifiable: false });
  });

  it("reports a refusal when the expected token no longer matches", async () => {
    setShell({ project_lock_takeover: async () => ({ acquired: false, record: wireRecord }) });
    const out = await takeOverProjectLock("/p/w.dwk", "stale-expectation");
    expect(out?.ok).toBe(false);
  });
});

describe("releaseProjectLock", () => {
  it("returns false with no bridge", async () => {
    expect(await releaseProjectLock("/p/w.dwk", "tok")).toBe(false);
  });

  it("returns true on a successful release", async () => {
    setShell({ project_lock_release: async () => ({ released: true }) });
    expect(await releaseProjectLock("/p/w.dwk", "tok")).toBe(true);
  });

  it("returns false on a token mismatch or a provider-side failure — never throws", async () => {
    setShell({ project_lock_release: async () => ({ released: false, error: "token mismatch" }) });
    expect(await releaseProjectLock("/p/w.dwk", "wrong")).toBe(false);
  });
});
