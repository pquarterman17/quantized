import { describe, expect, it } from "vitest";

import {
  CHAR_FRACTION,
  DEFAULT_LABEL_TEMPLATE,
  MAX_STACK_TIERS,
  TIER_STEP_FRAC,
  placeLabels,
  renderLabelTemplate,
  type LabelPlacement,
  type LabelSourcePeak,
} from "./peakLabels";

function peak(center: number, height = 5, fwhm = 0.8, area: number | null = 4): LabelSourcePeak {
  return { center, height, fwhm, area };
}

/** Recomputes each placement's own axis-aligned box — LEFT-ALIGNED from the
 *  anchor extending right, UP-FROM-ANCHOR extending up (N2 review finding,
 *  round 4: the SAME geometry `placeLabels` uses internally, matching how
 *  `annotationLayout` actually draws a label — never a symmetric
 *  centered/half-width-sum box, which under-counts a wide label followed by
 *  a narrow one) — and asserts NO TWO overlap: the actual invariant
 *  "collision-aware placement" promises (L6), not just "the internal tier
 *  numbers differ". Additive per-axis epsilons (M1, round 3: exact-tier-step
 *  float rounding can land a hair under the true threshold) mean two boxes
 *  exactly touching are adjacent, not overlapping, on either side of that
 *  rounding. */
function assertNoOverlap(
  placed: LabelPlacement[],
  labels: string[],
  xRange: [number, number],
  yRange: [number, number],
): void {
  const xW = xRange[1] - xRange[0] > 0 ? xRange[1] - xRange[0] : 1;
  const yW = yRange[1] - yRange[0] > 0 ? yRange[1] - yRange[0] : 1;
  const xEps = xW * 1e-9;
  const yEps = yW * 1e-9;
  const w = (i: number) => xW * CHAR_FRACTION * Math.max(1, labels[i].length);
  const boxH = TIER_STEP_FRAC * yW;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const ax = placed[i].x, ay = placed[i].y, aw = w(i);
      const bx = placed[j].x, by = placed[j].y, bw = w(j);
      const overlaps =
        ax + xEps < bx + bw - xEps && bx + xEps < ax + aw - xEps &&
        ay + yEps < by + boxH - yEps && by + yEps < ay + boxH - yEps;
      expect(overlaps, `labels ${i} and ${j} overlap`).toBe(false);
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

  it("M5 review finding: clamps an out-of-range precision INSIDE the helper too — defense in depth for this exported pure function", () => {
    // toFixed throws RangeError above 100 — this exported helper must never
    // rely on a call site to have already clamped it.
    expect(() => renderLabelTemplate("{center}", peak(2), 0, 999)).not.toThrow();
    const text = renderLabelTemplate("{center}", peak(2), 0, 999);
    expect(text).toBe((2).toFixed(100)); // clamped to the toFixed ceiling, not aborted
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

  it("never returns NaN for a zero-width x AND y range, and stays clamped to it (M2)", () => {
    const placed = placeLabels([{ x: 7, y: 7 }], ["7.00"], [7, 7], [7, 7]);
    expect(Number.isFinite(placed[0].x)).toBe(true);
    expect(Number.isFinite(placed[0].y)).toBe(true);
    // A zero-width yRange means the apex is ALREADY at the range's own top —
    // the M2 backstop clamps to it rather than letting the base offset push
    // past (which the pre-M2 version of this test asserted as the expected,
    // now-wrong, behavior).
    expect(placed[0].y).toBe(7);
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

// Helper: a tight cluster of `n` same-apex-y peaks, close enough in x that
// EVERY pair could collide (so only y-tiering resolves it) — the same
// shape the M1/M2 tests below need repeatedly.
function tightCluster(n: number, apexY = 5): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: 10 + i * 0.05, y: apexY }));
}

describe("placeLabels — M1 review finding: the honest capacity guarantee", () => {
  const CAPACITY = MAX_STACK_TIERS + 1; // labels a dense cluster holds with zero overlap

  it(`a cluster of exactly ${CAPACITY} (= MAX_STACK_TIERS + 1) peaks: zero overlaps`, () => {
    const points = tightCluster(CAPACITY);
    const labels = points.map((_, i) => `${i}.00`);
    const xRange: [number, number] = [0, 20];
    const yRange: [number, number] = [0, 10000]; // generous — isolates capacity from the M2 y-range clamp
    const placed = placeLabels(points, labels, xRange, yRange);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    assertNoOverlap(placed, labels, xRange, yRange);
    // Every label really did land at its OWN distinct tier.
    expect(new Set(placed.map((p) => p.y.toFixed(6))).size).toBe(CAPACITY);
  });

  it("capacity genuinely exhausted (more peaks than the cluster can hold): excess peaks pile deterministically onto the last tier, not off into the unknown", () => {
    const extra = 5;
    const points = tightCluster(CAPACITY + extra);
    const labels = points.map((_, i) => `${i}.00`);
    const xRange: [number, number] = [0, 20];
    const yRange: [number, number] = [0, 10000];
    const placed = placeLabels(points, labels, xRange, yRange);

    // Never NaN/Infinity even when exhausted.
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The first CAPACITY labels (sorted by x, which matches this fixture's
    // input order) still occupy CAPACITY distinct tiers...
    const within = placed.slice(0, CAPACITY);
    expect(new Set(within.map((p) => p.y.toFixed(6))).size).toBe(CAPACITY);
    // ...but every peak from CAPACITY onward piles onto the SAME last tier —
    // deterministic, not random, and not off-plot (M2 covers that half).
    const pile = placed.slice(CAPACITY - 1); // last in-capacity slot + all overflow
    const pileY = pile[0].y;
    for (const p of pile) expect(p.y).toBeCloseTo(pileY, 9);
    // And — the honest part of the guarantee — this pile DOES overlap
    // (same tight x cluster, identical y): calling this "no overlap" would
    // be false, so the test asserts the overlap explicitly rather than
    // leaving the exhaustion case unasserted.
    const overlapsSomewhere = (() => {
      for (let i = 0; i < pile.length; i++) {
        for (let j = i + 1; j < pile.length; j++) {
          if (Math.abs(pile[i].x - pile[j].x) < 2 && pile[i].y === pile[j].y) return true;
        }
      }
      return false;
    })();
    expect(overlapsSomewhere).toBe(true);
  });
});

describe("placeLabels — M2 review finding: stacked labels never run off the plotted y-range", () => {
  it("a dense cluster (well past capacity) on a SMALL y-range still produces labels all within yRange", () => {
    const points = tightCluster(20, /* apexY */ 0);
    const labels = points.map((_, i) => `${i}.00`);
    const xRange: [number, number] = [0, 20];
    const yRange: [number, number] = [0, 10]; // small — the M2 repro shape
    const placed = placeLabels(points, labels, xRange, yRange);
    for (const p of placed) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeLessThanOrEqual(yRange[1]);
      expect(p.y).toBeGreaterThanOrEqual(yRange[0]);
    }
  });

  it("a smaller (6-peak) cluster also stays within a small y-range", () => {
    const points = tightCluster(6, 0);
    const labels = points.map((_, i) => `${i}.00`);
    const xRange: [number, number] = [0, 20];
    const yRange: [number, number] = [0, 10];
    const placed = placeLabels(points, labels, xRange, yRange);
    for (const p of placed) {
      expect(p.y).toBeLessThanOrEqual(yRange[1]);
    }
  });
});

describe("placeLabels — N1 review finding, round 4: up-or-down instead of a hard clamp", () => {
  // The round-3 M2 fix clamped an over-tall stack's y onto yRange's own
  // top AFTER tier resolution, then fed that CLAMPED value into later
  // collision checks — so two DIFFERENT apex heights whose up-candidates
  // both exceeded the range both collapsed onto the exact same clamped y.
  // Since yRange is typically the data's own range, the TALLEST peak's
  // apex always equals yRange[1] — so this fired on every real dataset:
  // an XRD Kα1/Kα2 doublet on the strongest reflection drew both labels
  // on top of each other. This is the coordinator's own verified repro.
  it("the exact doublet repro: two distinct, non-overlapping, in-range labels (not identical)", () => {
    const placed = placeLabels(
      [{ x: 44.5, y: 10000 }, { x: 44.6, y: 9800 }],
      ["44.50", "44.60"],
      [20, 80],
      [0, 10000],
    );
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(10000);
    }
    expect(placed[0].y).not.toBe(placed[1].y); // the exact round-3 bug: both collapsed to 10000
    assertNoOverlap(placed, ["44.50", "44.60"], [20, 80], [0, 10000]);
  });

  it("a cluster sitting AT the very top of the range stays in range and non-overlapping", () => {
    const yRange: [number, number] = [0, 10000];
    const points = [
      { x: 10, y: 10000 },
      { x: 10.05, y: 10000 },
      { x: 10.1, y: 9950 },
      { x: 10.15, y: 9900 },
      { x: 10.2, y: 10000 },
    ];
    const labels = points.map((_, i) => `${i}.00`);
    const placed = placeLabels(points, labels, [0, 20], yRange);
    for (const p of placed) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(yRange[0]);
      expect(p.y).toBeLessThanOrEqual(yRange[1]);
    }
    assertNoOverlap(placed, labels, [0, 20], yRange);
  });

  it("a label that fits comfortably above its apex still places upward, unchanged (up stays preferred)", () => {
    const placed = placeLabels([{ x: 5, y: 10 }], ["10.00"], [0, 10], [0, 100]);
    expect(placed[0].y).toBeGreaterThan(10); // above the apex, not below
  });

  it("capacity/exhaustion guarantees from M1 still hold unchanged when up never needs to flip (apex far from the top)", () => {
    // Same fixture as the M1 capacity test — apex near yRange's BOTTOM, so
    // up never exceeds the range and this exercises the ordinary,
    // unflipped capacity search end to end.
    const CAPACITY = MAX_STACK_TIERS + 1;
    const points = tightCluster(CAPACITY);
    const labels = points.map((_, i) => `${i}.00`);
    const placed = placeLabels(points, labels, [0, 20], [0, 10000]);
    assertNoOverlap(placed, labels, [0, 20], [0, 10000]);
    expect(new Set(placed.map((p) => p.y.toFixed(6))).size).toBe(CAPACITY);
  });
});

describe("placeLabels — N2 review finding, round 4: box geometry matches the renderer", () => {
  it("a wide label followed by a narrow one, at a gap the OLD symmetric test missed, is now correctly detected as colliding", () => {
    // xRange width 50, CHAR_FRACTION 0.014: wide label (29 chars) full
    // width ≈ 20.3, narrow label (1 char) full width ≈ 0.7. The OLD
    // symmetric half-width-sum threshold was (20.3+0.7)/2 = 10.5; picking
    // a gap of 15 sits ABOVE that (old test: "clear") but BELOW the wide
    // label's own full width of 20.3 (true test: "overlaps") — exactly
    // the gap the review finding describes.
    const xRange: [number, number] = [0, 50];
    const yRange: [number, number] = [0, 100];
    const points = [{ x: 10, y: 5 }, { x: 25, y: 5 }]; // gap = 15
    const labels = ["a very long peak label indeed", "x"];
    const placed = placeLabels(points, labels, xRange, yRange);
    // If the collision had gone undetected, both would land at the SAME
    // (base) tier — same y. Detecting it means the narrow label was
    // bumped to a different tier.
    expect(placed[0].y).not.toBeCloseTo(placed[1].y, 6);
    assertNoOverlap(placed, labels, xRange, yRange);
  });
});
