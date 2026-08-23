// The desktop filesystem LockProvider adapter (I2 audit fix, P0-3/P1-1).
// Mocks `window.pywebview.api` at the SAME boundary the existing bridge
// tests use (desktopBridge.test.ts) — this file's job is only the
// wire-shape -> `LockProvider` translation (fail-closed on "no bridge" /
// "unverifiable" / a thrown exception), since the actual CAS mechanics are
// proven server-side (tests/test_desktop_project_lock.py) and the raw wire
// calls are proven in desktopBridge.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDesktopLockProvider } from "./desktopLockProvider";

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

const expectedLockRecord = {
  instanceId: "inst-1",
  acquiredAt: 1000,
  heartbeatAt: 1000,
  pid: "4242",
  token: "tok-1",
};

describe("createDesktopLockProvider — read", () => {
  it("returns null with no bridge", async () => {
    const provider = createDesktopLockProvider();
    expect(await provider.read("/p/w.dwk")).toBeNull();
  });

  it("translates a wire record into a LockRecord", async () => {
    setShell({ project_lock_read: async () => ({ acquired: null, record: wireRecord }) });
    const provider = createDesktopLockProvider();
    expect(await provider.read("/p/w.dwk")).toEqual(expectedLockRecord);
  });

  it("treats an unverifiable lock file as null — fail-closed, never a guess", async () => {
    setShell({ project_lock_read: async () => ({ acquired: null, unverifiable: true, error: "corrupt" }) });
    const provider = createDesktopLockProvider();
    expect(await provider.read("/p/w.dwk")).toBeNull();
  });

  it("a thrown read call is null, same as no bridge", async () => {
    setShell({
      project_lock_read: () => {
        throw new Error("IPC channel closed");
      },
    });
    const provider = createDesktopLockProvider();
    expect(await provider.read("/p/w.dwk")).toBeNull();
  });

  it("a malformed (non-object) read response is null, same as no bridge", async () => {
    setShell({ project_lock_read: async () => "not an outcome object" as unknown as Record<string, unknown> });
    const provider = createDesktopLockProvider();
    expect(await provider.read("/p/w.dwk")).toBeNull();
  });
});

describe("createDesktopLockProvider — tryAcquire", () => {
  // R4 (post-sprint independent review): this used to assert
  // `{ acquired: false, record: null }` with NO `unverifiable` flag — the
  // exact defect the review found. `store/projectLock.ts`'s
  // `statusFromRefusal` classifies a flag-less `record: null` refusal as
  // plain `"unlocked"`, so `openProject` could report `readOnly: false`
  // after this call never actually reached a bridge at all.
  it("no bridge -> acquired: false AND flags unverifiable (never guesses success, never guesses unlocked)", async () => {
    const provider = createDesktopLockProvider();
    const out = await provider.tryAcquire("/p/w.dwk");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });

  it("a THROWN bridge call is treated identically to no bridge — flags unverifiable, never guesses", async () => {
    setShell({
      project_lock_acquire: () => {
        throw new Error("IPC channel closed");
      },
    });
    const provider = createDesktopLockProvider();
    const out = await provider.tryAcquire("/p/w.dwk");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });

  it("a MALFORMED (non-object) response is treated the same as no bridge — flags unverifiable", async () => {
    // A version-skewed backend or a broken bridge stub resolving something
    // that isn't even a plain object — `"acquired"`/`"record"`/
    // `"unverifiable"` all read as `undefined` off a boxed primitive
    // without ever THROWING, so this can't be caught by a bare try/catch
    // alone; `lib/desktopLockBridge.ts`'s `isPlausibleOutcome` guard is
    // what catches it.
    setShell({ project_lock_acquire: async () => "not an outcome object" as unknown as Record<string, unknown> });
    const provider = createDesktopLockProvider();
    const out = await provider.tryAcquire("/p/w.dwk");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });

  it("a successful acquisition translates the record", async () => {
    setShell({ project_lock_acquire: async () => ({ acquired: true, record: wireRecord }) });
    const provider = createDesktopLockProvider();
    const out = await provider.tryAcquire("/p/w.dwk");
    expect(out).toEqual({ acquired: true, record: expectedLockRecord, contended: false });
  });

  it("a refusal reports the CURRENT (other) record, not a guess", async () => {
    const other = { ...wireRecord, instanceId: "other-instance", token: "other-token" };
    setShell({ project_lock_acquire: async () => ({ acquired: false, record: other }) });
    const provider = createDesktopLockProvider();
    const out = await provider.tryAcquire("/p/w.dwk");
    expect(out.acquired).toBe(false);
    expect(out.record?.instanceId).toBe("other-instance");
  });

  it("an unverifiable lock file refuses outright and flags unverifiable — never acquires over one it cannot verify", async () => {
    setShell({ project_lock_acquire: async () => ({ acquired: true, unverifiable: true, error: "corrupt" }) });
    const provider = createDesktopLockProvider();
    const out = await provider.tryAcquire("/p/w.dwk");
    // Even though the wire payload claims `acquired: true`, `unverifiable`
    // must win — a corrupt lock file can never be silently acquired over.
    expect(out.acquired).toBe(false);
    expect(out.record).toBeNull();
    // The flag itself matters: without it, a caller deriving status from
    // `record: null` alone would misclassify this as "unlocked" (see
    // store/projectLock.ts's `statusFromRefusal`).
    expect(out.unverifiable).toBe(true);
  });

  // R1's landed backend contract (main@fc85560): `contended` rides a
  // SUCCESS (`acquired: true`) — a "soft success" after the backend
  // internally retried past momentary OS-lock contention. An EARLIER
  // version of `toCasResult` forced ANY `contended: true` into a fake
  // `acquired: false` refusal (a pre-landing guess at the wire shape) —
  // that would have silently dropped every real soft-success success.
  it("a soft-success (acquired: true, contended: true) is passed through as an ORDINARY success — never forced into a fake refusal", async () => {
    setShell({ project_lock_acquire: async () => ({ acquired: true, record: wireRecord, contended: true }) });
    const provider = createDesktopLockProvider();
    const out = await provider.tryAcquire("/p/w.dwk");
    expect(out.acquired).toBe(true);
    expect(out.contended).toBe(true);
    expect(out.unverifiable).toBeFalsy();
    expect(out.record).toEqual(expectedLockRecord);
  });
});

describe("createDesktopLockProvider — refresh", () => {
  it("a token mismatch reports acquired: false with the current record", async () => {
    const current = { ...wireRecord, token: "someone-else" };
    setShell({ project_lock_refresh: async () => ({ refreshed: false, record: current }) });
    const provider = createDesktopLockProvider();
    const out = await provider.refresh("/p/w.dwk", "my-stale-token");
    expect(out.acquired).toBe(false);
    expect(out.record?.token).toBe("someone-else");
  });

  it("a successful refresh translates the updated record", async () => {
    setShell({ project_lock_refresh: async () => ({ refreshed: true, record: { ...wireRecord, heartbeatAt: 2000 } }) });
    const provider = createDesktopLockProvider();
    const out = await provider.refresh("/p/w.dwk", "tok-1");
    expect(out.acquired).toBe(true);
    expect(out.record?.heartbeatAt).toBe(2000);
  });

  // R4: refresh is what `store/projectLock.ts`'s periodic heartbeat calls
  // — a thrown/malformed refresh must flag unverifiable, not just report
  // `acquired: false`, so the store's consecutive-miss demotion logic (see
  // `UNVERIFIABLE_DEMOTE_AFTER`) can tell "definitely lost" apart from
  // "couldn't check".
  it("no bridge -> flags unverifiable (never a bare acquired:false with no reason)", async () => {
    const provider = createDesktopLockProvider();
    const out = await provider.refresh("/p/w.dwk", "tok-1");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });

  it("a thrown refresh call flags unverifiable", async () => {
    setShell({
      project_lock_refresh: () => {
        throw new Error("pipe broke");
      },
    });
    const provider = createDesktopLockProvider();
    const out = await provider.refresh("/p/w.dwk", "tok-1");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });

  it("a malformed (non-object) refresh response flags unverifiable", async () => {
    setShell({ project_lock_refresh: async () => 12345 as unknown as Record<string, unknown> });
    const provider = createDesktopLockProvider();
    const out = await provider.refresh("/p/w.dwk", "tok-1");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });
});

describe("createDesktopLockProvider — takeOver", () => {
  it("succeeds and mints a fresh record", async () => {
    const fresh = { ...wireRecord, token: "brand-new-token" };
    setShell({ project_lock_takeover: async () => ({ acquired: true, record: fresh }) });
    const provider = createDesktopLockProvider();
    const out = await provider.takeOver("/p/w.dwk", "expected-token");
    expect(out.acquired).toBe(true);
    expect(out.record?.token).toBe("brand-new-token");
  });

  it("refuses when the expected token no longer matches", async () => {
    setShell({ project_lock_takeover: async () => ({ acquired: false, record: wireRecord }) });
    const provider = createDesktopLockProvider();
    const out = await provider.takeOver("/p/w.dwk", "stale-expectation");
    expect(out.acquired).toBe(false);
  });

  it("no bridge -> flags unverifiable, never claims a takeover happened", async () => {
    const provider = createDesktopLockProvider();
    const out = await provider.takeOver("/p/w.dwk", "expected-token");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });

  it("a thrown takeover call flags unverifiable", async () => {
    setShell({
      project_lock_takeover: () => {
        throw new Error("IPC channel closed");
      },
    });
    const provider = createDesktopLockProvider();
    const out = await provider.takeOver("/p/w.dwk", "expected-token");
    expect(out).toEqual({ acquired: false, record: null, unverifiable: true });
  });
});

describe("createDesktopLockProvider — release", () => {
  it("no bridge -> false", async () => {
    const provider = createDesktopLockProvider();
    expect(await provider.release("/p/w.dwk", "tok")).toBe(false);
  });

  it("true on success", async () => {
    setShell({ project_lock_release: async () => ({ released: true }) });
    const provider = createDesktopLockProvider();
    expect(await provider.release("/p/w.dwk", "tok")).toBe(true);
  });

  it("false on a token mismatch or provider-side failure (e.g. Windows delete-while-open)", async () => {
    setShell({ project_lock_release: async () => ({ released: false, error: "PermissionError" }) });
    const provider = createDesktopLockProvider();
    expect(await provider.release("/p/w.dwk", "tok")).toBe(false);
  });
});
