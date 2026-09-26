// P2.5 review finding 7 — the shared preview machinery
// (identity-token WeakMap/tokenOf, the debounce, the "acknowledged for this
// key" state) extracted out of `useReshapePreview.ts` and
// `resample/useResample.ts`, which had each grown its own near-identical copy.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { tokenOf, useAckForKey, useDebouncedPreview, useLatestRef } from "./previewKey";

describe("tokenOf", () => {
  it("is stable for the same object and distinct across objects", () => {
    const a = {};
    const b = {};
    const t1 = tokenOf(a);
    expect(tokenOf(a)).toBe(t1);
    expect(tokenOf(b)).not.toBe(t1);
  });
});

describe("useLatestRef", () => {
  it("always reads the value from the LATEST render, not the one at mount", () => {
    const { result, rerender } = renderHook(({ v }: { v: number }) => useLatestRef(v), { initialProps: { v: 1 } });
    expect(result.current.current).toBe(1);
    rerender({ v: 2 });
    expect(result.current.current).toBe(2);
  });
});

describe("useAckForKey", () => {
  it("is acknowledged only for the EXACT key it was set for, and re-arms on a key change", () => {
    const { result, rerender } = renderHook(({ key }: { key: string }) => useAckForKey(key), { initialProps: { key: "a" } });
    expect(result.current.acknowledged).toBe(false);
    act(() => result.current.setAcknowledged(true));
    expect(result.current.acknowledged).toBe(true);
    // A different key (a new form edit) is not covered by the old ack.
    rerender({ key: "b" });
    expect(result.current.acknowledged).toBe(false);
  });

  it("a blank key (\"\") is never considered acknowledged", () => {
    const { result } = renderHook(() => useAckForKey(""));
    act(() => result.current.setAcknowledged(true));
    expect(result.current.acknowledged).toBe(false);
  });
});

describe("useDebouncedPreview", () => {
  it("fires once, after the delay, and not at all for a blank key", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    renderHook(({ key }: { key: string }) => useDebouncedPreview(key, 100, run), { initialProps: { key: "" } });
    await vi.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("restarts the timer on a key change before it fires — the stale timer never runs", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { rerender } = renderHook(({ key }: { key: string }) => useDebouncedPreview(key, 100, run), { initialProps: { key: "a" } });
    await vi.advanceTimersByTimeAsync(50);
    rerender({ key: "b" }); // "a"'s pending timer must never fire
    await vi.advanceTimersByTimeAsync(50); // 100ms since mount, but only 50ms since "b" started
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50); // 100ms since "b" started
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("calls the cleanup a fired run returned before the next key's timer starts", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const run = vi.fn(() => cleanup);
    const { rerender } = renderHook(({ key }: { key: string }) => useDebouncedPreview(key, 100, run), { initialProps: { key: "a" } });
    await vi.advanceTimersByTimeAsync(100); // "a"'s run fires and returns `cleanup`
    expect(run).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    rerender({ key: "b" });
    expect(cleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
