import { describe, expect, it } from "vitest";

import type { ErrorBinding } from "../../../lib/errorRoles";
import { appendErrorBinding, patchErrorBindingList, removeErrorBindingFromList } from "./canonicalErrors";

const binding = (
  channel: number,
  target: number,
  axis: ErrorBinding["axis"],
  side: ErrorBinding["side"],
): ErrorBinding => ({ channel, target, axis, side });

describe("patchErrorBindingList", () => {
  it("merges into only the binding at the given index", () => {
    const bindings = [binding(1, 0, "y", "both"), binding(2, 0, "y", "both")];
    expect(patchErrorBindingList(bindings, 1, { side: "+" })).toEqual([
      binding(1, 0, "y", "both"),
      binding(2, 0, "y", "+"),
    ]);
  });

  it("returns every other binding by reference (no needless re-render churn)", () => {
    const untouched = binding(1, 0, "y", "both");
    const next = patchErrorBindingList([untouched, binding(2, 0, "y", "both")], 1, { side: "-" });
    expect(next[0]).toBe(untouched);
  });

  it("is a no-op for an out-of-range index", () => {
    const bindings = [binding(1, 0, "y", "both")];
    expect(patchErrorBindingList(bindings, 5, { side: "+" })).toEqual(bindings);
  });
});

describe("removeErrorBindingFromList", () => {
  it("drops only the binding at the given index", () => {
    expect(removeErrorBindingFromList([binding(1, 0, "y", "both"), binding(2, 0, "y", "both")], 0)).toEqual([
      binding(2, 0, "y", "both"),
    ]);
  });

  it("is a no-op for an out-of-range index", () => {
    const bindings = [binding(1, 0, "y", "both")];
    expect(removeErrorBindingFromList(bindings, 5)).toEqual(bindings);
  });
});

describe("appendErrorBinding", () => {
  it("appends a binding with no id to mint, unlike ref lines/shapes", () => {
    expect(appendErrorBinding([binding(1, 0, "y", "both")], 2, 1, "y", "+")).toEqual([
      binding(1, 0, "y", "both"),
      binding(2, 1, "y", "+"),
    ]);
  });

  it("does not mutate the input list", () => {
    const bindings: ErrorBinding[] = [binding(1, 0, "y", "both")];
    appendErrorBinding(bindings, 2, 0, "x", "both");
    expect(bindings).toHaveLength(1);
  });
});
