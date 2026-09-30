// Round 7, round 2 (adversarial review): the two small fixes on
// useStableByValue --
//  1. `serialize` must run AT MOST ONCE per render, and not at all when
//     `value` is reference-equal to what's already stored.
//  2. `null` must be handled the same way `undefined` is -- never cast
//     through `serialize`, which a `T = Foo[] | null` caller could not
//     satisfy at runtime.

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { sameContent, useStableByEquality, useStableByValue } from "./useStableValue";

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

describe("sameContent", () => {
  it("compares arrays, Maps and plain objects by content, recursively", () => {
    expect(sameContent([1, null, undefined], [1, null, undefined])).toBe(true);
    expect(sameContent(new Map([[1, [0.5, null]]]), new Map([[1, [0.5, null]]]))).toBe(true);
    expect(sameContent({ axis: "y", plus: [1] }, { axis: "y", plus: [1] })).toBe(true);
    expect(sameContent(new Map(), new Map())).toBe(true);
    expect(sameContent([NaN], [NaN])).toBe(true);
  });

  it("reports a change in any element, key or size", () => {
    expect(sameContent([1, 2], [1, 3])).toBe(false);
    expect(sameContent([1], [1, 2])).toBe(false);
    expect(sameContent(new Map([[1, [1]]]), new Map([[2, [1]]]))).toBe(false);
    expect(sameContent({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameContent([1], new Map())).toBe(false);
  });

  it("compares functions and class instances by identity", () => {
    expect(sameContent(() => 1, () => 1)).toBe(false);
    expect(sameContent(new Date(0), new Date(0))).toBe(false);
  });
});

describe("useStableByEquality", () => {
  it("keeps the first reference while the content is unchanged, and compares each new identity once", () => {
    const equal = vi.fn(sameContent);
    const { result, rerender } = renderHook((v: number[]) => useStableByEquality(v, equal), { initialProps: [1, 2] });
    const first = result.current;
    const copy = [1, 2];
    rerender(copy);
    expect(result.current).toBe(first);
    rerender(copy); // the same content-equal identity again: already seen
    expect(result.current).toBe(first);
    expect(equal).toHaveBeenCalledTimes(1);

    const changed = [1, 3];
    rerender(changed);
    expect(result.current).toBe(changed);
  });
});
