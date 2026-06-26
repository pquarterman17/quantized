import { describe, expect, it } from "vitest";

import { centralRange } from "./inset";

describe("centralRange", () => {
  it("returns the centred fraction of the span", () => {
    // 30% of [0,100] centred on 50 -> [35, 65].
    expect(centralRange(0, 100, 0.3)).toEqual([35, 65]);
  });

  it("clamps fraction >= 1 to the full range", () => {
    expect(centralRange(0, 100, 1)).toEqual([0, 100]);
    expect(centralRange(0, 100, 2)).toEqual([0, 100]);
  });

  it("returns the endpoints for a degenerate or non-finite span", () => {
    expect(centralRange(5, 5)).toEqual([5, 5]);
    expect(centralRange(10, 0)).toEqual([10, 0]);
    expect(centralRange(NaN, 1)).toEqual([NaN, 1]);
  });
});
