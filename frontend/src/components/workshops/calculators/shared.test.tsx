// useCard provenance contract (DIRACULATOR_AUDIT P1): a displayed calculator
// result is either CURRENT for the visible inputs or gone. These tests force
// the races with hand-resolved deferred promises — completion order is under
// test control, never timing luck (docs/testing.md evidence standard).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useCalcHistory } from "../../../store/calcHistory";
import { useCard } from "./shared";

/** A promise whose resolve/reject the test holds. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useCalcHistory.setState({ history: [], favorites: [], seq: 0 });
  localStorage.clear();
});

describe("useCard — request provenance", () => {
  it("an older in-flight request never overwrites a newer result (out-of-order completion)", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const slow = deferred<string>();
    const fast = deferred<string>();

    let p1: Promise<void>, p2: Promise<void>;
    act(() => {
      p1 = result.current.run("slow", () => slow.promise); // issued first...
      p2 = result.current.run("fast", () => fast.promise);
    });
    await act(async () => {
      fast.resolve("NEW");
      await p2;
    });
    expect(result.current.result).toEqual({ text: "NEW" });

    await act(async () => {
      slow.resolve("STALE"); // ...completes last
      await p1;
    });
    // The stale completion is dropped outright — display AND history.
    expect(result.current.result).toEqual({ text: "NEW" });
    const summaries = useCalcHistory.getState().history.map((e) => e.summary);
    expect(summaries).toEqual(["NEW"]);
  });

  it("a stale ERROR cannot clobber a newer result either", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const failing = deferred<string>();
    const ok = deferred<string>();

    let p1: Promise<void>, p2: Promise<void>;
    act(() => {
      p1 = result.current.run("failing", () => failing.promise);
      p2 = result.current.run("ok", () => ok.promise);
    });
    await act(async () => {
      ok.resolve("GOOD");
      await p2;
      failing.reject(new Error("boom"));
      await p1;
    });
    expect(result.current.result).toEqual({ text: "GOOD" });
  });

  it("touch() clears the displayed result immediately", async () => {
    const { result } = renderHook(() => useCard("Test"));
    await act(async () => {
      await result.current.run("calc", () => Promise.resolve("R"));
    });
    expect(result.current.result).toEqual({ text: "R" });

    act(() => result.current.touch());
    expect(result.current.result).toBeNull();
  });

  it("touch() disowns a pending request issued for the old inputs", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const d = deferred<string>();

    let p: Promise<void>;
    act(() => {
      p = result.current.run("calc", () => d.promise);
      result.current.touch(); // the user edited an input while pending
    });
    await act(async () => {
      d.resolve("STALE");
      await p;
    });
    // Neither displayed nor recorded — it answered a question no longer asked.
    expect(result.current.result).toBeNull();
    expect(useCalcHistory.getState().history).toHaveLength(0);
  });

  it("touch() disowns a pending request's ERROR too", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const d = deferred<string>();

    let p: Promise<void>;
    act(() => {
      p = result.current.run("calc", () => d.promise);
      result.current.touch();
    });
    await act(async () => {
      d.reject(new Error("stale failure"));
      await p;
    });
    expect(result.current.result).toBeNull();
  });

  it("history is written only by the completion that owns the display", async () => {
    const { result } = renderHook(() => useCard("Dom"));
    await act(async () => {
      await result.current.run("first", () => Promise.resolve("A"));
      await result.current.run("second", () => Promise.resolve("B"));
    });
    const h = useCalcHistory.getState().history;
    expect(h.map((e) => e.summary)).toEqual(["B", "A"]); // newest-first, both owned
    expect(h[0].domain).toBe("Dom");
  });

  it("errors surface inline with the API message", async () => {
    const { result } = renderHook(() => useCard("Test"));
    await act(async () => {
      await result.current.run("calc", () => Promise.reject(new Error("T must be positive")));
    });
    expect(result.current.result).toEqual({ text: "T must be positive", err: true });
    expect(useCalcHistory.getState().history).toHaveLength(0); // failures never recorded
  });
});
