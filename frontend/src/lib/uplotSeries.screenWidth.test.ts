import { describe, expect, it } from "vitest";

import { screenStrokeWidth } from "./uplotSeries";

describe("screenStrokeWidth (A5: thin lines draw at least one device pixel, on screen only)", () => {
  it("raises a hairline to 1 device px", () => {
    expect(screenStrokeWidth(0.1, 1)).toBe(1);
    expect(screenStrokeWidth(0.1, 2)).toBe(0.5);
    expect(screenStrokeWidth(0.25, 4)).toBe(0.25);
  });
  it("leaves a wide-enough line and 'no line' alone", () => {
    expect(screenStrokeWidth(1.5, 2)).toBe(1.5);
    expect(screenStrokeWidth(0, 2)).toBe(0);
  });
  it("falls back to 1x for a bad ratio", () => {
    expect(screenStrokeWidth(0.2, 0)).toBe(1);
  });
});
