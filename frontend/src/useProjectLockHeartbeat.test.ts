// PR I2 (L0.47): without a periodic heartbeat, a perfectly healthy
// held-by-me session would silently go STALE after STALE_AFTER_MS and
// become takeover-vulnerable — this hook is what keeps a live session's
// heartbeat fresh. store/projectLock.ts's `heartbeat()` itself is exhaustively
// tested; this covers only the scheduling (starts while held-by-me, stops
// otherwise, cleans up on unmount).

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HEARTBEAT_INTERVAL_MS } from "./lib/lockState";
import { useProjectLock } from "./store/projectLock";
import { useProjectLockHeartbeat } from "./useProjectLockHeartbeat";

beforeEach(() => {
  vi.useFakeTimers();
  useProjectLock.setState({
    status: "unlocked",
    record: null,
    path: null,
    openedAsCopy: false,
    provider: {
      read: async () => null,
      tryAcquire: async () => ({ acquired: true, record: null }),
      refresh: async () => ({ acquired: true, record: null }),
      takeOver: async () => ({ acquired: true, record: null }),
      release: async () => true,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useProjectLockHeartbeat", () => {
  it("does nothing while not held-by-me", () => {
    const heartbeat = vi.fn();
    useProjectLock.setState({ status: "held-by-other-live", heartbeat });
    renderHook(() => useProjectLockHeartbeat());
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("calls heartbeat() on the configured interval while held-by-me", () => {
    const heartbeat = vi.fn();
    useProjectLock.setState({ status: "held-by-me", path: "/p/x.dwk", heartbeat });
    renderHook(() => useProjectLockHeartbeat());
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it("stops scheduling once unmounted", () => {
    const heartbeat = vi.fn();
    useProjectLock.setState({ status: "held-by-me", path: "/p/x.dwk", heartbeat });
    const { unmount } = renderHook(() => useProjectLockHeartbeat());
    unmount();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(heartbeat).not.toHaveBeenCalled();
  });
});
