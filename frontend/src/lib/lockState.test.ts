import { describe, expect, it } from "vitest";

import {
  acquire,
  canAcquireDirectly,
  canRelease,
  canTakeOver,
  classifyLock,
  HEARTBEAT_INTERVAL_MS,
  isReadOnly,
  refreshHeartbeat,
  STALE_AFTER_MS,
  takeOver,
  verifyBeforeWrite,
  type LockRecord,
} from "./lockState";

const ME = "instance-me";
const OTHER = "instance-other";
const T0 = 1_000_000;

function record(instanceId: string, heartbeatAt: number, over: Partial<LockRecord> = {}): LockRecord {
  return { instanceId, acquiredAt: heartbeatAt, heartbeatAt, ...over };
}

describe("classifyLock — the four-state table", () => {
  it("null record is unlocked", () => {
    expect(classifyLock(null, ME, T0)).toBe("unlocked");
  });

  it("a record naming ME is held-by-me, regardless of heartbeat age", () => {
    expect(classifyLock(record(ME, T0 - 999_999), ME, T0)).toBe("held-by-me");
  });

  it("a record naming someone else, heartbeating recently, is held-by-other-live", () => {
    expect(classifyLock(record(OTHER, T0 - 1_000), ME, T0)).toBe("held-by-other-live");
  });

  it("a record naming someone else, heartbeat older than STALE_AFTER_MS, is held-by-other-stale", () => {
    expect(classifyLock(record(OTHER, T0 - STALE_AFTER_MS - 1), ME, T0)).toBe("held-by-other-stale");
  });

  it("boundary: exactly STALE_AFTER_MS old is still live (strictly greater than the threshold is required)", () => {
    expect(classifyLock(record(OTHER, T0 - STALE_AFTER_MS), ME, T0)).toBe("held-by-other-live");
  });

  it("boundary: one ms past STALE_AFTER_MS is stale", () => {
    expect(classifyLock(record(OTHER, T0 - STALE_AFTER_MS - 1), ME, T0)).toBe("held-by-other-stale");
  });

  it("STALE_AFTER_MS is three heartbeat intervals (documented reasoning, pinned)", () => {
    expect(STALE_AFTER_MS).toBe(3 * HEARTBEAT_INTERVAL_MS);
  });
});

describe("canAcquireDirectly / canTakeOver / isReadOnly — gating", () => {
  it("unlocked and held-by-me can acquire directly; the other-held states cannot", () => {
    expect(canAcquireDirectly("unlocked")).toBe(true);
    expect(canAcquireDirectly("held-by-me")).toBe(true);
    expect(canAcquireDirectly("held-by-other-live")).toBe(false);
    expect(canAcquireDirectly("held-by-other-stale")).toBe(false);
  });

  it("ONLY held-by-other-stale permits Take Over Editing — never held-by-other-live", () => {
    expect(canTakeOver("held-by-other-stale")).toBe(true);
    expect(canTakeOver("held-by-other-live")).toBe(false);
    expect(canTakeOver("unlocked")).toBe(false);
    expect(canTakeOver("held-by-me")).toBe(false);
  });

  it("both other-held states are read-only; mine and unlocked are not", () => {
    expect(isReadOnly("held-by-other-live")).toBe(true);
    expect(isReadOnly("held-by-other-stale")).toBe(true);
    expect(isReadOnly("unlocked")).toBe(false);
    expect(isReadOnly("held-by-me")).toBe(false);
  });
});

describe("acquire / refreshHeartbeat", () => {
  it("acquire mints a record naming the caller with acquiredAt === heartbeatAt === now", () => {
    const r = acquire(ME, T0);
    expect(r).toEqual({ instanceId: ME, acquiredAt: T0, heartbeatAt: T0 });
  });

  it("acquire carries an optional pid", () => {
    expect(acquire(ME, T0, "1234").pid).toBe("1234");
  });

  it("refreshHeartbeat updates heartbeatAt (not acquiredAt) when the caller already owns the record", () => {
    const held = record(ME, T0, { acquiredAt: T0 - 50_000 });
    const refreshed = refreshHeartbeat(held, ME, T0 + HEARTBEAT_INTERVAL_MS);
    expect(refreshed).toEqual({ ...held, heartbeatAt: T0 + HEARTBEAT_INTERVAL_MS });
  });

  it("refreshHeartbeat refuses (null) to extend a lock the caller does not own", () => {
    const held = record(OTHER, T0);
    expect(refreshHeartbeat(held, ME, T0 + 1_000)).toBeNull();
  });
});

describe("takeOver — the L0.47 hard gate, enforced at the data level", () => {
  it("succeeds against a stale other-held lock, minting a completely fresh record", () => {
    const stale = record(OTHER, T0 - STALE_AFTER_MS - 1, { acquiredAt: T0 - 999_999 });
    const result = takeOver(stale, ME, T0, "pid-me");
    expect(result).toEqual({ instanceId: ME, acquiredAt: T0, heartbeatAt: T0, pid: "pid-me" });
  });

  it("refuses against a LIVE other-held lock — no override exists", () => {
    const live = record(OTHER, T0 - 1_000);
    expect(takeOver(live, ME, T0)).toBeNull();
  });

  it("refuses against an unlocked project (nothing to take OVER — use acquire instead)", () => {
    expect(takeOver(null, ME, T0)).toBeNull();
  });

  it("refuses against a lock this instance ALREADY holds (acquire/refresh is the right call, not takeOver)", () => {
    const mine = record(ME, T0 - STALE_AFTER_MS - 1);
    expect(takeOver(mine, ME, T0)).toBeNull();
  });
});

describe("verifyBeforeWrite — the false-positive safety net", () => {
  it("permits a write when the current record still names the caller", () => {
    expect(verifyBeforeWrite(record(ME, T0), ME)).toBe(true);
  });

  it("refuses a write when the record now names someone else (a takeover happened underneath this instance)", () => {
    expect(verifyBeforeWrite(record(OTHER, T0), ME)).toBe(false);
  });

  it("refuses a write when the record is gone entirely", () => {
    expect(verifyBeforeWrite(null, ME)).toBe(false);
  });

  it("forces the resumed-holder race: a suspended instance's lock goes stale, a second instance takes over, the FIRST instance's next write is refused, never silently clobbering the second", () => {
    // T0: instance A acquires and starts editing.
    let current: LockRecord | null = acquire("A", T0);
    // A is suspended (laptop lid closed) for far longer than STALE_AFTER_MS —
    // no heartbeat refresh happens during this window.
    const resumeAt = T0 + STALE_AFTER_MS + 5_000;
    // Meanwhile instance B opens the same project, observes A's lock is
    // stale, and legitimately takes over.
    const afterB = takeOver(current, "B", T0 + STALE_AFTER_MS + 1_000);
    expect(afterB).not.toBeNull();
    current = afterB;
    // A resumes and, believing it still holds the lock, attempts a write —
    // verifyBeforeWrite must catch this against the CURRENT record, not A's
    // own stale belief.
    expect(verifyBeforeWrite(current, "A")).toBe(false);
    // B, the legitimate current holder, can still write.
    expect(verifyBeforeWrite(current, "B")).toBe(true);
    void resumeAt;
  });
});

describe("canRelease", () => {
  it("true only for the actual holder", () => {
    expect(canRelease(record(ME, T0), ME)).toBe(true);
    expect(canRelease(record(OTHER, T0), ME)).toBe(false);
    expect(canRelease(null, ME)).toBe(false);
  });
});
