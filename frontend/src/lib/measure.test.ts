import { describe, expect, it } from "vitest";

import { computeMeasurement, formatMeasurement } from "./measure";

describe("computeMeasurement", () => {
  it("computes Δx, Δy, and slope for a rising segment", () => {
    const m = computeMeasurement(1, 2, 4, 8);
    expect(m.dx).toBe(3);
    expect(m.dy).toBe(6);
    expect(m.slope).toBe(2);
  });

  it("preserves drag direction in the sign of the deltas", () => {
    const m = computeMeasurement(4, 8, 1, 2); // dragged down-left
    expect(m.dx).toBe(-3);
    expect(m.dy).toBe(-6);
    expect(m.slope).toBe(2); // slope sign preserved
  });

  it("reports a negative slope for a falling segment", () => {
    const m = computeMeasurement(0, 10, 5, 0);
    expect(m.slope).toBe(-2);
  });

  it("returns null slope for a vertical segment (dx === 0)", () => {
    const m = computeMeasurement(3, 1, 3, 9);
    expect(m.dx).toBe(0);
    expect(m.dy).toBe(8);
    expect(m.slope).toBeNull();
  });

  it("keeps both endpoints for drawing", () => {
    const m = computeMeasurement(1.5, -2, 3, 4);
    expect([m.x0, m.y0, m.x1, m.y1]).toEqual([1.5, -2, 3, 4]);
  });
});

describe("formatMeasurement", () => {
  it("formats deltas and slope", () => {
    const s = formatMeasurement(computeMeasurement(1, 2, 4, 8));
    expect(s).toContain("Δx 3");
    expect(s).toContain("Δy 6");
    expect(s).toContain("slope 2");
  });

  it("labels a vertical segment as infinite slope", () => {
    const s = formatMeasurement(computeMeasurement(3, 1, 3, 9));
    expect(s).toContain("∞");
  });

  it("uses scientific notation for very large magnitudes", () => {
    const s = formatMeasurement(computeMeasurement(0, 0, 1, 250000));
    expect(s).toContain("e+5");
  });
});
