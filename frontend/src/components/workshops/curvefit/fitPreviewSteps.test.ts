import { describe, expect, it } from "vitest";

import { nudgeStart } from "./fitPreviewSteps";

describe("nudgeStart", () => {
  it("steps relative to the value: 1 % fine, 10 % coarse, either way", () => {
    expect(nudgeStart(200, 1, "fine")).toBe("202");
    expect(nudgeStart(200, -1, "fine")).toBe("198");
    expect(nudgeStart(200, 1, "coarse")).toBe("220");
    expect(nudgeStart(-4, 1, "coarse")).toBe("-3.6");
    expect(nudgeStart(3e-4, 1, "fine")).toBe("0.000303");
  });
  it("steps a zero by an absolute amount", () => {
    expect(nudgeStart(0, 1, "fine")).toBe("0.01");
    expect(nudgeStart(0, -1, "coarse")).toBe("-0.1");
  });
  it("leaves no floating point noise in the cell", () => {
    expect(nudgeStart(0.3, 1, "coarse")).toBe("0.33");
  });
  it("clamps into the row's own bounds so a nudge never makes a start the fit refuses", () => {
    expect(nudgeStart(10, 1, "coarse", { min: "", max: "10.5" })).toBe("10.5");
    expect(nudgeStart(10, -1, "coarse", { min: "9.5", max: "" })).toBe("9.5");
    expect(nudgeStart(10, 1, "fine", { min: "abc", max: "" })).toBe("10.1"); // an unreadable bound is no bound
  });
  it("refuses a non-finite value", () => {
    expect(nudgeStart(Number.NaN, 1, "fine")).toBeNull();
    expect(nudgeStart(Infinity, -1, "fine")).toBeNull();
  });
});
