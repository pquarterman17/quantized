// Shared workbench shell (lane WB): the commit guard. Races are forced with
// held promises.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWorkbenchCommit } from "./useWorkbenchCommit";

function held() {
  let release!: (v: string) => void;
  let signal: AbortSignal | undefined;
  const commit = (s: AbortSignal) => { signal = s; return new Promise<string>((resolve) => { release = resolve; }); };
  return { commit, release: (v: string) => release(v), signal: () => signal };
}

describe("useWorkbenchCommit", () => {
  it("two commits while one is pending make ONE (the second resolves null)", async () => {
    const { result } = renderHook(() => useWorkbenchCommit());
    const h = held();
    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    let calls = 0;
    await act(async () => {
      first = result.current.run((s) => { calls += 1; return h.commit(s); });
      second = result.current.run((s) => { calls += 1; return h.commit(s); });
    });
    expect(calls).toBe(1);
    expect(result.current.busy).toBe(true);
    await expect(second).resolves.toBeNull();
    await act(async () => { h.release("made"); await first; });
    await expect(first).resolves.toBe("made");
    expect(result.current.busy).toBe(false);
  });

  it("abort (Cancel) aborts the pending commit's signal", async () => {
    const { result } = renderHook(() => useWorkbenchCommit());
    const h = held();
    await act(async () => { void result.current.run(h.commit); });
    act(() => result.current.abort());
    expect(h.signal()?.aborted).toBe(true);
  });

  it("abort releases the guard at once, even if the transport answers later", async () => {
    const { result } = renderHook(() => useWorkbenchCommit());
    const h = held();
    await act(async () => { void result.current.run(h.commit); });
    act(() => result.current.abort());
    expect(result.current.busy).toBe(false);
    let ran = false;
    await act(async () => { await result.current.run(async () => { ran = true; }); });
    expect(ran).toBe(true);
    await act(async () => { h.release("late"); await Promise.resolve(); });
    expect(result.current.busy).toBe(false);
  });

  it("unmount aborts the pending commit (closing the window mid-commit)", async () => {
    const { result, unmount } = renderHook(() => useWorkbenchCommit());
    const h = held();
    await act(async () => { void result.current.run(h.commit); });
    unmount();
    expect(h.signal()?.aborted).toBe(true);
  });

  it("a failed commit releases the guard for the next one", async () => {
    const { result } = renderHook(() => useWorkbenchCommit());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("refused"))).catch(() => undefined);
    });
    let ran = false;
    await act(async () => { await result.current.run(async () => { ran = true; }); });
    expect(ran).toBe(true);
  });
});
