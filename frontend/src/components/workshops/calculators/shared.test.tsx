// useCard provenance contract (DIRACULATOR_AUDIT P1): a displayed calculator
// result is either CURRENT for the visible inputs or gone. These tests force
// the races with hand-resolved deferred promises — completion order is under
// test control, never timing luck (docs/testing.md evidence standard).

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyText } from "../../../lib/clipboard";
import { useCalcHistory } from "../../../store/calcHistory";
import { dual, parseXYPairs, type CardSuccess, resultLine, useCard } from "./shared";

vi.mock("../../../lib/clipboard", () => ({ copyText: vi.fn() }));

const success = (text: string, copyValue = text): CardSuccess => ({ text, copyValue });

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
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(true);
});

describe("parseXYPairs", () => {
  it("accepts comma-, space-, and tab-separated two-column rows", () => {
    expect(parseXYPairs("1, 2\n3 4\n5\t6")).toEqual({
      x: [1, 3, 5],
      y: [2, 4, 6],
    });
  });

  it("skips blank, single-token, and non-finite rows", () => {
    expect(parseXYPairs("T chi\n\n3\n4 nope\n5 6\n7 Infinity")).toEqual({
      x: [5],
      y: [6],
    });
  });

  it("rejects an all-3-column paste, naming every offending line", () => {
    expect(() => parseXYPairs("1 2 0.1\n3 4 0.1\n5 6 0.1")).toThrow(
      "lines 1, 2, 3: expected exactly 2 columns (x, y); found 3",
    );
  });

  it("rejects a partial 3-column paste instead of fitting the 2-column subset", () => {
    expect(() => parseXYPairs("1 2\n3 4 999\n5 6\n\n8 9 extra")).toThrow(
      "lines 2, 5: expected exactly 2 columns (x, y); found 3",
    );
    expect(() => parseXYPairs("1 2\n3,4,5,6")).toThrow(
      "line 2: expected exactly 2 columns (x, y); found 4",
    );
  });
});

describe("dual — one template for display text and clipboard copy", () => {
  it("fmtNum's numbers for text and keeps String() precision for copy", () => {
    expect(dual`ρ = ${1.2345678901234} Ω·cm`).toEqual({
      text: "ρ = 1.23457 Ω·cm",
      copyValue: "ρ = 1.2345678901234 Ω·cm",
    });
    expect(dual`${1e-7} A`).toEqual({ text: "1.00000e-7 A", copyValue: "1e-7 A" });
  });

  it("passes strings through verbatim in both and handles no interpolations", () => {
    expect(dual`${"n"}-type · ${"1.23456789"}`).toEqual({
      text: "n-type · 1.23456789",
      copyValue: "n-type · 1.23456789",
    });
    expect(dual`h_c = ∞`).toEqual({ text: "h_c = ∞", copyValue: "h_c = ∞" });
  });

  it("splices a nested dual (conditional suffix) into each side, or nothing", () => {
    const suffix = (rho: number | null) => (rho != null ? dual` · ρ = ${rho} Ω·cm` : "");
    expect(dual`Rs = ${10.123456789} Ω/sq${suffix(2.000000001)}`).toEqual({
      text: "Rs = 10.1235 Ω/sq · ρ = 2 Ω·cm",
      copyValue: "Rs = 10.123456789 Ω/sq · ρ = 2.000000001 Ω·cm",
    });
    expect(dual`Rs = ${10} Ω/sq${suffix(null)}`).toEqual({
      text: "Rs = 10 Ω/sq",
      copyValue: "Rs = 10 Ω/sq",
    });
  });

  it("renders a runtime null/NaN the way fmtNum did (em-dash text, raw copy)", () => {
    expect(dual`x = ${NaN}; y = ${null as unknown as number}`).toEqual({
      text: "x = —; y = —",
      copyValue: "x = NaN; y = null",
    });
  });
});

describe("useCard — request provenance", () => {
  it("keeps the full-precision clipboard value separate from rounded display text", async () => {
    const { result } = renderHook(() => useCard("Test"));
    await act(async () => {
      await result.current.run("calc", "x=1", () =>
        Promise.resolve(success("D = 1.235 nm", "D = 1.23456789012345 nm")),
      );
    });

    expect(result.current.result).toEqual({
      text: "D = 1.235 nm",
      copyValue: "D = 1.23456789012345 nm",
    });
    expect(useCalcHistory.getState().history[0].summary).toBe("D = 1.235 nm");
  });

  it("copies the exact value rather than the rounded display text", () => {
    render(resultLine(success("D = 1.235 nm", "D = 1.23456789012345 nm")));

    fireEvent.click(screen.getByRole("button", { name: "copy result" }));

    expect(copyText).toHaveBeenCalledWith("D = 1.23456789012345 nm");
  });

  it("an older in-flight request never overwrites a newer result (out-of-order completion)", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const slow = deferred<CardSuccess>();
    const fast = deferred<CardSuccess>();

    let p1: Promise<void>, p2: Promise<void>;
    act(() => {
      p1 = result.current.run("slow", "x=1", () => slow.promise); // issued first...
      p2 = result.current.run("fast", "x=2", () => fast.promise);
    });
    await act(async () => {
      fast.resolve(success("NEW"));
      await p2;
    });
    expect(result.current.result).toEqual(success("NEW"));

    await act(async () => {
      slow.resolve(success("STALE")); // ...completes last
      await p1;
    });
    // The stale completion is dropped outright — display AND history.
    expect(result.current.result).toEqual(success("NEW"));
    const summaries = useCalcHistory.getState().history.map((e) => e.summary);
    expect(summaries).toEqual(["NEW"]);
  });

  it("a stale ERROR cannot clobber a newer result either", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const failing = deferred<CardSuccess>();
    const ok = deferred<CardSuccess>();

    let p1: Promise<void>, p2: Promise<void>;
    act(() => {
      p1 = result.current.run("failing", "x=1", () => failing.promise);
      p2 = result.current.run("ok", "x=2", () => ok.promise);
    });
    await act(async () => {
      ok.resolve(success("GOOD"));
      await p2;
      failing.reject(new Error("boom"));
      await p1;
    });
    expect(result.current.result).toEqual(success("GOOD"));
  });

  it("touch() clears the displayed result immediately", async () => {
    const { result } = renderHook(() => useCard("Test"));
    await act(async () => {
      await result.current.run("calc", "x=1", () => Promise.resolve(success("R")));
    });
    expect(result.current.result).toEqual(success("R"));

    act(() => result.current.touch());
    expect(result.current.result).toBeNull();
  });

  it("touch() disowns a pending request issued for the old inputs", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const d = deferred<CardSuccess>();

    let p: Promise<void>;
    act(() => {
      p = result.current.run("calc", "x=1", () => d.promise);
      result.current.touch(); // the user edited an input while pending
    });
    await act(async () => {
      d.resolve(success("STALE"));
      await p;
    });
    // Neither displayed nor recorded — it answered a question no longer asked.
    expect(result.current.result).toBeNull();
    expect(useCalcHistory.getState().history).toHaveLength(0);
  });

  it("touch() disowns a pending request's ERROR too", async () => {
    const { result } = renderHook(() => useCard("Test"));
    const d = deferred<CardSuccess>();

    let p: Promise<void>;
    act(() => {
      p = result.current.run("calc", "x=1", () => d.promise);
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
      await result.current.run("first", "x=1", () => Promise.resolve(success("A")));
      await result.current.run("second", "x=2", () => Promise.resolve(success("B")));
    });
    const h = useCalcHistory.getState().history;
    expect(h.map((e) => e.summary)).toEqual(["B", "A"]); // newest-first, both owned
    expect(h.map((e) => e.inputs)).toEqual(["x=2", "x=1"]);
    expect(h[0].domain).toBe("Dom");
  });

  it("errors surface inline with the API message", async () => {
    const { result } = renderHook(() => useCard("Test"));
    await act(async () => {
      await result.current.run("calc", "T=-1", () => Promise.reject(new Error("T must be positive")));
    });
    expect(result.current.result).toEqual({ text: "T must be positive", err: true });
    expect(useCalcHistory.getState().history).toHaveLength(0); // failures never recorded
  });
});
