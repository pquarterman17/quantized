// useRunStamp (lane WB4): a result is stale once the live key differs from the
// key its run LAUNCHED with, including a change made while the run was in flight.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useRunStamp } from "./useRunStamp";

describe("useRunStamp", () => {
  it("is not stale before anything is recorded, and while the key is unchanged", () => {
    const { result } = renderHook(({ k }) => useRunStamp(k), { initialProps: { k: "a" } });
    expect(result.current.stale).toBe(false);
    act(() => result.current.record(result.current.launchKey()));
    expect(result.current.stale).toBe(false);
  });

  it("is stale when the key moves on, fresh again when it returns, and forgotten by record(null)", () => {
    const { result, rerender } = renderHook(({ k }) => useRunStamp(k), { initialProps: { k: "a" } });
    act(() => result.current.record(result.current.launchKey()));
    rerender({ k: "b" });
    expect(result.current.stale).toBe(true);
    rerender({ k: "a" });
    expect(result.current.stale).toBe(false);
    rerender({ k: "b" });
    act(() => result.current.record(null));
    expect(result.current.stale).toBe(false);
  });

  it("forced race: a key changed while the run was in flight leaves its result stale", () => {
    const { result, rerender } = renderHook(({ k }) => useRunStamp(k), { initialProps: { k: "a" } });
    const launched = result.current.launchKey(); // the run starts under "a"
    rerender({ k: "b" }); // the user edits while it runs
    act(() => result.current.record(launched)); // it lands
    expect(result.current.stale).toBe(true);
  });
});
