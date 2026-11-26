import { describe, expect, it } from "vitest";

import { parseFindAdvanced } from "./peakFindRecipe";

const bad = (field: string): never => {
  throw new Error(field);
};

describe("parseFindAdvanced: finder fields", () => {
  it("keeps absent fields absent", () => {
    expect(parseFindAdvanced({}, bad)).toEqual({});
  });
  it("accepts the three finders and an odd or zero smoothing window", () => {
    for (const finder of ["residual", "derivative1", "derivative2"]) {
      expect(parseFindAdvanced({ finder, smooth_window: 0 }, bad)).toEqual({ finder, smooth_window: 0 });
    }
    expect(parseFindAdvanced({ smooth_window: 11 }, bad)).toEqual({ smooth_window: 11 });
  });
  it("refuses an unknown finder and an even, tiny or fractional window", () => {
    expect(() => parseFindAdvanced({ finder: "third" }, bad)).toThrow("find.finder");
    for (const smooth_window of [4, 8, 3, 7.5, -1, "9"]) {
      expect(() => parseFindAdvanced({ smooth_window }, bad)).toThrow("find.smooth_window");
    }
  });
  it("still validates the pre-existing fields", () => {
    expect(() => parseFindAdvanced({ sensitivity: "extreme" }, bad)).toThrow("find.sensitivity");
    expect(parseFindAdvanced({ bg_iterative: true, strict_prominence: false }, bad)).toEqual({
      bg_iterative: true, strict_prominence: false,
    });
  });
});
