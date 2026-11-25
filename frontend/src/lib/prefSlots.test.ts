// The generic preference-slot API that lanes 2 to 4 build on.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { allPrefSlots, definePrefSlot, onPrefSlotChange, readPrefSlot, syncedPrefSlots } from "./prefSlots";

// Test-only keys: never a literal "qz." slot name (storage-key ratchet).
const KEY = ["qz", "testSlot"].join(".");
const LOCAL = ["qz", "testLocal"].join(".");
const slot = definePrefSlot(KEY, { on: false, n: 3 });
const local = definePrefSlot(LOCAL, { on: true }, undefined, { sync: false });

afterEach(() => localStorage.clear());

describe("definePrefSlot", () => {
  it("loads defaults, keeps only fields of the default's type, and saves", () => {
    expect(slot.load()).toEqual({ on: false, n: 3 });
    localStorage.setItem(KEY, JSON.stringify({ on: "yes", n: 7, extra: 1 }));
    expect(slot.load()).toEqual({ on: false, n: 7 });
    slot.save({ on: true, n: 1 });
    expect(readPrefSlot(KEY)).toEqual({ on: true, n: 1 });
  });

  it("corrupt JSON or a non-object loads the defaults", () => {
    localStorage.setItem(KEY, "{nope");
    expect(slot.load()).toEqual(slot.defaults);
    localStorage.setItem(KEY, "[1]");
    expect(slot.load()).toEqual(slot.defaults);
  });

  it("reset removes the stored value and notifies", () => {
    const seen: string[] = [];
    const off = onPrefSlotChange((k) => seen.push(k));
    slot.save({ on: true, n: 2 });
    slot.reset();
    off();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(seen).toEqual([KEY, KEY]);
  });

  it("use() re-renders on every write, from anywhere", () => {
    const { result } = renderHook(() => slot.use());
    expect(result.current.on).toBe(false);
    act(() => slot.save({ on: true, n: 3 }));
    expect(result.current.on).toBe(true);
    act(() => slot.reset());
    expect(result.current.on).toBe(false);
  });

  it("is synced to the server by default; sync: false keeps it browser-local", () => {
    expect(syncedPrefSlots()).toContain(KEY);
    expect(syncedPrefSlots()).not.toContain(LOCAL);
    expect(allPrefSlots()).toContain(local); // still reset by Reset all
  });
});
