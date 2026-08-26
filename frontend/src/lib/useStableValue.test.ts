// Round 7, round 2 (adversarial review): the two small fixes on
// useStableByValue --
//  1. `serialize` must run AT MOST ONCE per render, and not at all when
//     `value` is reference-equal to what's already stored.
//  2. `null` must be handled the same way `undefined` is -- never cast
//     through `serialize`, which a `T = Foo[] | null` caller could not
//     satisfy at runtime.

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStableByValue } from "./useStableValue";

describe("useStableByValue", () => {
  it("keeps its reference across renders when serialize(value) is unchanged", () => {
    const serialize = vi.fn((v: number[]) => JSON.stringify(v));
    const { result, rerender } = renderHook(
      (v: number[] | undefined) => useStableByValue(v, serialize),
      { initialProps: [1, 2] as number[] | undefined },
    );
    const first = result.current;

    rerender([1, 2]); // fresh array, same content
    expect(result.current).toBe(first);

    rerender([1, 2, 3]); // genuine change
    expect(result.current).not.toBe(first);
  });

  it("never calls serialize when value is reference-equal to the stored value", () => {
    const serialize = vi.fn((v: number[]) => JSON.stringify(v));
    const same = [1, 2];
    const { rerender } = renderHook((v: number[] | undefined) => useStableByValue(v, serialize), {
      initialProps: same as number[] | undefined,
    });
    serialize.mockClear(); // ignore the first-render call

    rerender(same); // the EXACT same reference
    expect(serialize).not.toHaveBeenCalled();
  });

  it("calls serialize at most once per render for a changed-identity value", () => {
    const serialize = vi.fn((v: number[]) => JSON.stringify(v));
    const { rerender } = renderHook((v: number[] | undefined) => useStableByValue(v, serialize), {
      initialProps: [1, 2] as number[] | undefined,
    });
    serialize.mockClear();

    rerender([1, 2]); // fresh array, same content -- still has to check once
    expect(serialize).toHaveBeenCalledTimes(1);
  });

  it("handles null without ever passing it to serialize (no runtime TypeError)", () => {
    const serialize = vi.fn((v: number[]) => JSON.stringify(v));
    const { result, rerender } = renderHook(
      (v: number[] | null) => useStableByValue(v, serialize),
      { initialProps: null as number[] | null },
    );
    expect(result.current).toBeNull();
    expect(serialize).not.toHaveBeenCalled();

    rerender([1, 2]);
    expect(result.current).toEqual([1, 2]);

    rerender(null);
    expect(result.current).toBeNull();
  });

  it("keeps null and undefined distinct -- neither is promoted to the other", () => {
    const serialize = vi.fn((v: number[]) => JSON.stringify(v));
    const { result, rerender } = renderHook(
      (v: number[] | null | undefined) => useStableByValue(v, serialize),
      { initialProps: undefined as number[] | null | undefined },
    );
    expect(result.current).toBeUndefined();

    rerender(null);
    expect(result.current).toBeNull(); // not still undefined
  });
});
