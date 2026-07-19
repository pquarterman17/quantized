import { describe, expect, it } from "vitest";

import { sanitizeAnnotations, sanitizeShapes } from "./plotview";

describe("plot object group persistence", () => {
  it("round-trips valid group ids and drops malformed ones", () => {
    expect(sanitizeAnnotations([
      { id: "a1", groupId: "g1", x: 1, y: 2, text: "A" },
      { id: "a2", groupId: 42, x: 3, y: 4, text: "B" },
    ])).toEqual([
      { id: "a1", groupId: "g1", x: 1, y: 2, text: "A" },
      { id: "a2", x: 3, y: 4, text: "B" },
    ]);
    expect(sanitizeShapes([
      { id: "s1", groupId: "g1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 },
    ])[0].groupId).toBe("g1");
  });
});
