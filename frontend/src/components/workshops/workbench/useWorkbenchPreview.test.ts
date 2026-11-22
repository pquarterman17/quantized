// Shared workbench shell (lane WB): the preview contract, forced
// deterministically (fake timers + deferred promises; no timing waits).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchPreview, type WorkbenchPreviewOptions } from "./useWorkbenchPreview";

interface Run { key: string; signal: AbortSignal; resolve: (v: string) => void; reject: (e: unknown) => void }
let runs: Run[];

function setup(initial: Partial<WorkbenchPreviewOptions<string>> & { key: string }) {
  return renderHook((props: Partial<WorkbenchPreviewOptions<string>> & { key: string }) => {
    const key = props.key;
    return useWorkbenchPreview<string>({
      delayMs: 100,
      run: (signal) => new Promise<string>((resolve, reject) => { runs.push({ key, signal, resolve, reject }); }),
      ...props,
    });
  }, { initialProps: initial });
}
const flush = () => act(async () => { await Promise.resolve(); });
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); runs = []; });
afterEach(() => vi.useRealTimers());

describe("useWorkbenchPreview — debounce", () => {
  it("runs once, delayMs after the last key change", () => {
    const h = setup({ key: "a" });
    tick(60);
    h.rerender({ key: "b" });
    tick(60);
    expect(runs).toHaveLength(0);
    expect(h.result.current.loading).toBe(true);
    tick(40);
    expect(runs.map((r) => r.key)).toEqual(["b"]);
  });

  it("an empty key previews nothing and is not loading", () => {
    const h = setup({ key: "" });
    tick(1000);
    expect(runs).toHaveLength(0);
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.current).toBeNull();
  });
});

describe("useWorkbenchPreview — stale responses", () => {
  it("forces the race: the older run resolving LAST never becomes current", async () => {
    const h = setup({ key: "a" });
    tick(100);
    h.rerender({ key: "b" });
    tick(100);
    expect(runs.map((r) => r.key)).toEqual(["a", "b"]);
    runs[1].resolve("B");
    await flush();
    runs[0].resolve("A");
    await flush();
    expect(h.result.current.current).toBe("B");
    expect(h.result.current.latest).toEqual({ key: "b", value: "B" });
  });

  it("a result for an older key is kept as latest but is never current (stale)", async () => {
    const h = setup({ key: "a" });
    tick(100);
    runs[0].resolve("A");
    await flush();
    expect(h.result.current.current).toBe("A");
    h.rerender({ key: "b" });
    expect(h.result.current.current).toBeNull();
    expect(h.result.current.stale).toBe(true);
    expect(h.result.current.latest?.value).toBe("A");
  });

  it("returning to an earlier key re-previews instead of trusting a pending flag", async () => {
    const h = setup({ key: "a" });
    tick(100);
    h.rerender({ key: "b" });
    h.rerender({ key: "a" });
    tick(100);
    runs.at(-1)!.resolve("A2");
    await flush();
    expect(h.result.current.current).toBe("A2");
    expect(h.result.current.loading).toBe(false);
  });
});

describe("useWorkbenchPreview — abort", () => {
  it("aborts the in-flight run when the key changes", () => {
    const h = setup({ key: "a" });
    tick(100);
    h.rerender({ key: "b" });
    expect(runs[0].signal.aborted).toBe(true);
  });

  it("aborts the in-flight run on unmount and writes nothing afterwards", async () => {
    const h = setup({ key: "a" });
    tick(100);
    h.unmount();
    expect(runs[0].signal.aborted).toBe(true);
    runs[0].resolve("late");
    await flush(); // no state update on an unmounted hook (would warn)
  });

  it("an AbortError is not an error; a real failure is, for its key only", async () => {
    const h = setup({ key: "a" });
    tick(100);
    runs[0].reject(Object.assign(new Error("x"), { name: "AbortError" }));
    await flush();
    expect(h.result.current.error).toBe("");
    h.rerender({ key: "b" });
    tick(100);
    runs[1].reject(new Error("refused: X reverses"));
    await flush();
    expect(h.result.current.error).toBe("refused: X reverses");
    expect(h.result.current.loading).toBe(false);
    h.rerender({ key: "c" });
    expect(h.result.current.error).toBe("");
  });

  it("a non-Error rejection uses the fallback message", async () => {
    const h = setup({ key: "a", fallbackError: "baseline failed" });
    tick(100);
    runs[0].reject("nope");
    await flush();
    expect(h.result.current.error).toBe("baseline failed");
  });

  it("discard aborts and forgets every result (Cancel leaves nothing)", async () => {
    const h = setup({ key: "a" });
    tick(100);
    runs[0].resolve("A");
    await flush();
    h.rerender({ key: "b" });
    tick(100);
    act(() => h.result.current.discard());
    expect(runs[1].signal.aborted).toBe(true);
    runs[1].resolve("B");
    await flush();
    expect(h.result.current.latest).toBeNull();
    expect(h.result.current.current).toBeNull();
  });
});

describe("useWorkbenchPreview — a run that throws synchronously", () => {
  it("is an error for its key, not an endless 'Previewing…'", async () => {
    const h = renderHook(() => useWorkbenchPreview<string>({ key: "a", delayMs: 100, run: () => { throw new Error("bad recipe"); } }));
    tick(100);
    await flush();
    expect(h.result.current.error).toBe("bad recipe");
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.running).toBe(false);
  });
});

describe("useWorkbenchPreview — discard in auto mode", () => {
  it("cancels a scheduled run and is not left loading", () => {
    const h = setup({ key: "a" });
    tick(50);
    act(() => h.result.current.discard());
    expect(h.result.current.loading).toBe(false);
    tick(1000);
    expect(runs).toHaveLength(0);
    h.rerender({ key: "b" }); // the next edit previews again
    tick(100);
    expect(runs.map((r) => r.key)).toEqual(["b"]);
  });
});

describe("useWorkbenchPreview — manual mode (an Estimate button)", () => {
  it("runs nothing until refresh, then runs at once and resolves when it settles", async () => {
    const h = setup({ key: "a", auto: false });
    tick(1000);
    expect(runs).toHaveLength(0);
    let done = false;
    await act(async () => { void h.result.current.refresh().then(() => { done = true; }); });
    expect(runs.map((r) => r.key)).toEqual(["a"]);
    expect(h.result.current.loading).toBe(true);
    expect(done).toBe(false);
    await act(async () => { runs[0].resolve("A"); await Promise.resolve(); });
    expect(done).toBe(true);
    expect(h.result.current.current).toBe("A");
  });

  it("a key change aborts a manual run and does not start another", async () => {
    const h = setup({ key: "a", auto: false });
    await act(async () => { void h.result.current.refresh(); });
    h.rerender({ key: "b", auto: false });
    expect(runs[0].signal.aborted).toBe(true);
    tick(1000);
    expect(runs).toHaveLength(1);
    expect(h.result.current.loading).toBe(false);
  });

  it("refresh with nothing previewable resolves without running", async () => {
    const h = setup({ key: "", auto: false });
    let done = false;
    await act(async () => { await h.result.current.refresh(); done = true; });
    expect(done).toBe(true);
    expect(runs).toHaveLength(0);
  });
});
