import { describe, expect, it } from "vitest";

import { byOrder, orderBetween } from "./order";

describe("orderBetween", () => {
  it("returns 0 for the first item in an empty container", () => {
    expect(orderBetween(undefined, undefined)).toBe(0);
  });

  it("appends after the last item", () => {
    expect(orderBetween(5, undefined)).toBe(6);
  });

  it("prepends before the first item", () => {
    expect(orderBetween(undefined, 5)).toBe(4);
  });

  it("bisects between two neighbors", () => {
    expect(orderBetween(0, 1)).toBe(0.5);
    expect(orderBetween(0.5, 1)).toBe(0.75);
  });
});

describe("byOrder", () => {
  it("sorts ascending by order key", () => {
    const items = [{ order: 2 }, { order: 0 }, { order: 1 }];
    expect([...items].sort(byOrder).map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it("keeps unordered items in their incoming order (stable) and sinks them last", () => {
    const items = [
      { id: "a" as const },
      { id: "b" as const, order: 5 },
      { id: "c" as const },
      { id: "d" as const, order: 1 },
    ];
    expect([...items].sort(byOrder).map((i) => i.id)).toEqual(["d", "b", "a", "c"]);
  });
});
