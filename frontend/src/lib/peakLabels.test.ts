import { describe, expect, it } from "vitest";

import {
  CHAR_FRACTION,
  DEFAULT_LABEL_TEMPLATE,
  TIER_STEP_FRAC,
  placeLabels,
  renderLabelTemplate,
  type LabelPlacement,
  type LabelSourcePeak,
} from "./peakLabels";

function peak(center: number, height = 5, fwhm = 0.8, area: number | null = 4): LabelSourcePeak {
  return { center, height, fwhm, area };
}

/** Recomputes each placement's own axis-aligned box (same formula
 *  `placeLabels` uses internally) and asserts NO TWO overlap — the actual
 *  invariant "collision-aware placement" promises (L6 review finding), not
 *  just "the internal tier numbers differ". */
function assertNoOverlap(
  placed: LabelPlacement[],
  labels: string[],
  xRange: [number, number],
  yRange: [number, number],
): void {
  const xW = xRange[1] - xRange[0] > 0 ? xRange[1] - xRange[0] : 1;
  const yW = yRange[1] - yRange[0] > 0 ? yRange[1] - yRange[0] : 1;
  const halfW = (i: number) => (xW * CHAR_FRACTION * Math.max(1, labels[i].length)) / 2;
  const yHalf = (TIER_STEP_FRAC * yW) / 2;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const dx = Math.abs(placed[i].x - placed[j].x);
      const dy = Math.abs(placed[i].y - placed[j].y);
      const overlaps = dx <= halfW(i) + halfW(j) && dy <= yHalf + yHalf;
      expect(overlaps, `labels ${i} and ${j} overlap at dx=${dx}, dy=${dy}`).toBe(false);
    }
  }
}

describe("renderLabelTemplate", () => {
  it("renders the default template as the center at the given precision", () => {
    expect(renderLabelTemplate(DEFAULT_LABEL_TEMPLATE, peak(12.3456), 0, 2)).toBe("12.35");
  });

  it("renders every honest token (center/height/fwhm/area/index)", () => {
    const text = renderLabelTemplate(
      "{center} h={height} w={fwhm} a={area} #{index}",
      peak(1.5, 9.25, 0.4, 3.1),
      2, // 0-based -> #3
      1,
    );
    expect(text).toBe("1.5 h=9.3 w=0.4 a=3.1 #3");
  });

  it("renders a null area token as empty text, not 'null'", () => {
    expect(renderLabelTemplate("{area}", peak(1, 2, 3, null), 0, 2)).toBe("");
  });

  it("renders an UNKNOWN token literally instead of throwing (e.g. a future {phase}/{hkl})", () => {
    expect(() => renderLabelTemplate("{phase} {center}", peak(5), 0, 2)).not.toThrow();
    expect(renderLabelTemplate("{phase} {center}", peak(5), 0, 2)).toBe("{phase} 5.00");
    expect(renderLabelTemplate("{hkl}", peak(5), 0, 2)).toBe("{hkl}");
  });

  it("respects the precision control", () => {
    expect(renderLabelTemplate("{center}", peak(3.14159), 0, 0)).toBe("3");
    expect(renderLabelTemplate("{center}", peak(3.14159), 0, 4)).toBe("3.1416");
  });

  it("preserves literal text around tokens", () => {
    expect(renderLabelTemplate("peak {index}: {center} Å", peak(2), 4, 1)).toBe("peak 5: 2.0 Å");
  });

  it("clamps a negative/non-finite precision to 0 instead of throwing", () => {
    expect(() => renderLabelTemplate("{center}", peak(2), 0, -3)).not.toThrow();
    expect(renderLabelTemplate("{center}", peak(2), 0, NaN)).toBe("2");
  });
});

describe("placeLabels", () => {
  it("returns [] for no peaks", () => {
    expect(placeLabels([], [], [0, 10], [0, 10])).toEqual([]);
  });

  it("places a single peak's label above its apex, using a fraction of the y-range", () => {
    const [pos] = placeLabels([{ x: 5, y: 10 }], ["5.00"], [0, 10], [0, 100]);
    expect(pos.x).toBe(5);
    expect(pos.y).toBeGreaterThan(10);
    expect(Number.isFinite(pos.y)).toBe(true);
  });

  it("well-separated peaks all share the base tier (identical y-offset above their own apex)", () => {
    const points = [{ x: 0, y: 10 }, { x: 50, y: 12 }, { x: 100, y: 8 }];
    const labels = ["a", "b", "c"];
    const xRange: [number, number] = [0, 100];
    const yRange: [number, number] = [0, 20];
    const placed = placeLabels(points, labels, xRange, yRange);
    const offsets = placed.map((p, i) => p.y - points[i].y);
    expect(offsets[0]).toBeCloseTo(offsets[1], 9);
    expect(offsets[1]).toBeCloseTo(offsets[2], 9);
  });

  it("densely clustered peaks stagger into distinct, non-overlapping y tiers", () => {
    // Same apex y so any tier difference shows up directly as a y difference.
    const points = [
      { x: 10.0, y: 5 },
      { x: 10.05, y: 5 },
      { x: 10.1, y: 5 },
    ];
    const labels = ["1.00", "2.00", "3.00"];
    const xRange: [number, number] = [0, 20];
    const yRange: [number, number] = [0, 10];
    const placed = placeLabels(points, labels, xRange, yRange);
    const ys = placed.map((p) => p.y);
    expect(new Set(ys.map((y) => y.toFixed(6))).size).toBe(3); // three DISTINCT tiers
    // strictly increasing tiers for the strictly-increasing-x cluster
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
  });

  it("returns results in the SAME order as the input, not x-sorted order", () => {
    const points = [{ x: 10, y: 1 }, { x: 0, y: 2 }, { x: 5, y: 3 }];
    const labels = ["c", "a", "b"];
    const placed = placeLabels(points, labels, [0, 10], [0, 10]);
    expect(placed.map((p) => p.x)).toEqual([10, 0, 5]); // x unchanged, order preserved
  });

  it("never returns NaN when every peak sits at the same x", () => {
    const points = [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }];
    const labels = ["a", "bb", "ccc"];
    const placed = placeLabels(points, labels, [3, 3], [1, 3]);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("never returns NaN for a zero-width x AND y range", () => {
    const placed = placeLabels([{ x: 7, y: 7 }], ["7.00"], [7, 7], [7, 7]);
    expect(Number.isFinite(placed[0].x)).toBe(true);
    expect(Number.isFinite(placed[0].y)).toBe(true);
    expect(placed[0].y).toBeGreaterThan(7);
  });

  it("never returns NaN for a single peak", () => {
    const placed = placeLabels([{ x: 1, y: 1 }], ["x"], [0, 1], [0, 1]);
    expect(placed).toHaveLength(1);
    expect(Number.isFinite(placed[0].x)).toBe(true);
    expect(Number.isFinite(placed[0].y)).toBe(true);
  });

  it("ignores extra labels/points beyond the shorter array's length, without throwing", () => {
    const placed = placeLabels(
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      ["only-one"],
      [0, 1],
      [0, 1],
    );
    expect(placed).toHaveLength(1);
  });
});

describe("placeLabels — L6 review finding: 2-D collision with UNEQUAL apex heights", () => {
  // Old (buggy) algorithm: tier chosen from X-ONLY proximity, then each
  // label offset relative to its OWN apex y. Two x-close neighbours whose
  // apex heights differ by close to one tier step land at the SAME
  // absolute y despite getting DIFFERENT tier numbers — collision-aware
  // placement produced an actual collision. This reproduces exactly that
  // geometry and asserts it no longer collides.
  it("the specific 'neighbour one tier step taller' case no longer collides", () => {
    const xRange: [number, number] = [0, 20]; // xUnit = 20
    const yRange: [number, number] = [0, 100]; // yUnit = 100
    const yUnit = 100;
    const step = TIER_STEP_FRAC * yUnit; // one tier step in y

    // A sits low; B sits `step` below A, close in x. Old algorithm: A gets
    // tier 0 (y = 0 + base). B, x-close to A, gets tier 1 under x-only
    // logic: y = (0 - step) + base + step = base — IDENTICAL to A's y.
    const points = [
      { x: 10, y: 0 }, // A
      { x: 10.3, y: -step }, // B, one tier step lower, close in x
    ];
    const labels = ["5.00", "3.00"];

    const placed = placeLabels(points, labels, xRange, yRange);
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The old bug: placed[1].y would equal placed[0].y (both === base).
    expect(placed[1].y).not.toBeCloseTo(placed[0].y, 6);
    assertNoOverlap(placed, labels, xRange, yRange);
  });

  it("unequal apex heights, x-close: no two labels overlap (general property)", () => {
    const xRange: [number, number] = [0, 50];
    const yRange: [number, number] = [0, 40];
    const points = [
      { x: 5, y: 1 },
      { x: 5.2, y: 8 },
      { x: 5.4, y: 3 },
      { x: 5.6, y: 6 },
      { x: 5.8, y: 0.5 },
    ];
    const labels = ["1.0", "2.0", "3.0", "4.0", "5.0"];
    const placed = placeLabels(points, labels, xRange, yRange);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    assertNoOverlap(placed, labels, xRange, yRange);
  });

  it("a long label next to short ones gets a wider berth (per-label width, not an average)", () => {
    const xRange: [number, number] = [0, 50];
    const yRange: [number, number] = [0, 10];
    const points = [{ x: 10, y: 5 }, { x: 10.5, y: 5 }];
    const labels = ["a very long peak label indeed", "x"];
    const placed = placeLabels(points, labels, xRange, yRange);
    assertNoOverlap(placed, labels, xRange, yRange);
  });
});
