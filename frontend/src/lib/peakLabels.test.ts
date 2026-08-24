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

/** Independent re-implementation of the SAME y-transform `placeLabels`
 *  itself uses (round 6, P1+P2) — kept deliberately separate from
 *  `peakLabels.ts`'s own `yTransform` so a box-overlap test that reuses the
 *  PRODUCTION transform could never mask a bug in that transform. */
function testFwd(yScale: "linear" | "log" | "reciprocal", v: number): number {
  if (yScale === "log") return v > 0 ? Math.log10(v) : NaN;
  if (yScale === "reciprocal") return v > 0 ? 1 / v : NaN;
  return v;
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
 *  rounding.
 *
 *  P1+P2 (round 6): the Y comparison happens in the SAME transformed space
 *  `placeLabels` itself now uses for a non-linear `yScale` — a box-height
 *  comparison done in plain data units would be just as wrong here as it
 *  was inside the implementation itself (that mismatch WAS the root cause
 *  round 6 fixed). `yRange` is given in DATA space either way (matching
 *  `placeLabels`'s own signature); this helper transforms it exactly once,
 *  the same way `placeLabels` does. */
function assertNoOverlap(
  placed: LabelPlacement[],
  labels: string[],
  xRange: [number, number],
  yRange: [number, number],
  yScale: "linear" | "log" | "reciprocal" = "linear",
): void {
  const xW = xRange[1] - xRange[0] > 0 ? xRange[1] - xRange[0] : 1;
  const yLoT = testFwd(yScale, Math.min(yRange[0], yRange[1]));
  const yHiT = testFwd(yScale, Math.max(yRange[0], yRange[1]));
  const yTransformable = Number.isFinite(yLoT) && Number.isFinite(yHiT) && yLoT !== yHiT;
  const yW = yTransformable
    ? Math.abs(yHiT - yLoT)
    : Math.max(yRange[1] - yRange[0], 0) > 0
      ? yRange[1] - yRange[0]
      : 1;
  const toT = (y: number): number => {
    if (!yTransformable) return y;
    const t = testFwd(yScale, y);
    return Number.isFinite(t) ? t : Math.min(yLoT, yHiT);
  };
  const xEps = xW * 1e-9;
  const yEps = yW * 1e-9;
  const w = (i: number) => xW * CHAR_FRACTION * Math.max(1, labels[i].length);
  const boxH = TIER_STEP_FRAC * yW;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const ax = placed[i].x, ay = toT(placed[i].y), aw = w(i);
      const bx = placed[j].x, by = toT(placed[j].y), bw = w(j);
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

  it("capacity genuinely exhausted (more peaks than the cluster can hold): excess peaks deterministically fall back to their OWN apex (round-5 contract point 2 — never a boundary clamp), not off into the unknown", () => {
    const extra = 5;
    const points = tightCluster(CAPACITY + extra); // all share apex y = 5, well inside yRange
    const labels = points.map((_, i) => `${i}.00`);
    const xRange: [number, number] = [0, 20];
    const yRange: [number, number] = [0, 10000];
    const placed = placeLabels(points, labels, xRange, yRange);

    // Never NaN/Infinity even when exhausted.
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(yRange[0]);
      expect(p.y).toBeLessThanOrEqual(yRange[1]);
    }
    // The first CAPACITY labels (sorted by x, matching this fixture's input
    // order) still occupy CAPACITY distinct tiers, all ABOVE the apex —
    // down never gets reached for them (apex=5 is near yRange's bottom, so
    // the up direction has all the headroom `MAX_STACK_TIERS` needs).
    const within = placed.slice(0, CAPACITY);
    expect(new Set(within.map((p) => p.y.toFixed(6))).size).toBe(CAPACITY);
    for (const p of within) expect(p.y).toBeGreaterThan(5);
    // Every peak from CAPACITY onward is genuinely exhausted in BOTH
    // directions (up: every tier already occupied; down: apex=5 is too
    // close to yRange[0]=0 for any tier's down-candidate to stay in range)
    // — round 5's contract (point 2) says the fallback for an IN-RANGE
    // apex is the apex's OWN position, deterministically, never a
    // boundary clamp. So every excess label lands exactly ON its apex.
    const overflow = placed.slice(CAPACITY);
    for (const p of overflow) expect(p.y).toBe(5);
    // And — the honest part of the guarantee — this pile DOES overlap
    // (same tight x cluster, identical y): calling this "no overlap" would
    // be false, so the test asserts the overlap explicitly rather than
    // leaving the exhaustion case unasserted.
    expect(overflow.length).toBeGreaterThan(1);
    expect(Math.abs(overflow[0].x - overflow[1].x)).toBeLessThan(2);
    expect(overflow[0].y).toBe(overflow[1].y);
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

describe("placeLabels — O1 review finding, round 5: the contract — anchor to the APEX, never the window edge", () => {
  it("the exact repro: two off-range apexes stay distinct and near their OWN apex; only the in-range one is pinned inside yRange", () => {
    const placed = placeLabels(
      [{ x: 10, y: 5000 }, { x: 30, y: 8000 }, { x: 50, y: 60 }],
      ["a", "b", "c"],
      [0, 60],
      [0, 100],
    );
    expect(placed).toHaveLength(3);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The old bug: both off-range apexes (5000, 8000) collapsed onto the
    // SAME clamped y=100 (the window edge) — not distinct, not near their
    // own apex, and a WRONG permanent coordinate.
    expect(placed[0].y).not.toBe(placed[1].y);
    expect(placed[0].y).not.toBe(100);
    expect(placed[1].y).not.toBe(100);
    // Contract point 3: off-range apexes are placed RELATIVE TO THEIR OWN
    // apex — near 5000 and 8000 respectively, not at the window edge.
    expect(placed[0].y).toBeGreaterThan(4000);
    expect(placed[0].y).toBeLessThan(6000);
    expect(placed[1].y).toBeGreaterThan(7000);
    expect(placed[1].y).toBeLessThan(9000);
    // Contract point 2: the ONE in-range apex (60) IS guaranteed inside yRange.
    expect(placed[2].y).toBeGreaterThanOrEqual(0);
    expect(placed[2].y).toBeLessThanOrEqual(100);
  });

  it("an apex outside the range is placed near ITS OWN apex even when that means landing off-screen (never window-edge-pinned)", () => {
    const placed = placeLabels([{ x: 5, y: 500 }], ["500.00"], [0, 10], [0, 10]);
    expect(Number.isFinite(placed[0].y)).toBe(true);
    expect(placed[0].y).toBeGreaterThan(400); // near 500, not clamped to yRange[1]=10
  });

  it("a wholly exhausted IN-RANGE apex falls back to the apex's OWN position (never a boundary clamp)", () => {
    // A zero-width range: the apex (7) is trivially "inside" [7, 7], and no
    // offset in either direction can also stay inside a zero-width range —
    // the only value that satisfies contract point 2 is the apex itself.
    const placed = placeLabels([{ x: 7, y: 7 }], ["7.00"], [7, 7], [7, 7]);
    expect(placed[0].y).toBe(7);
  });
});

describe("placeLabels — O2 review finding, round 5: descending ranges are normalized to ascending", () => {
  it("a descending yRange no longer collapses every label onto one y (the exact repro)", () => {
    const placed = placeLabels(
      [{ x: 10, y: 500 }, { x: 30, y: 200 }, { x: 50, y: 900 }],
      ["a", "b", "c"],
      [0, 60],
      [1000, 0], // descending
    );
    expect(placed).toHaveLength(3);
    // The old bug: all three collapsed onto y=0.
    const ys = new Set(placed.map((p) => p.y));
    expect(ys.size).toBeGreaterThan(1);
    for (const p of placed) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1000);
    }
  });

  it("a descending yRange produces the SAME result as the equivalent ascending one", () => {
    const points = [{ x: 10, y: 500 }, { x: 30, y: 200 }, { x: 50, y: 900 }];
    const labels = ["a", "b", "c"];
    const ascendingResult = placeLabels(points, labels, [0, 60], [0, 1000]);
    const descendingResult = placeLabels(points, labels, [0, 60], [1000, 0]);
    expect(descendingResult).toEqual(ascendingResult);
  });

  it("a descending xRange also normalizes (no crash, same box-width math as ascending)", () => {
    const points = [{ x: 10, y: 5 }, { x: 15, y: 5 }];
    const labels = ["a", "b"];
    const ascendingResult = placeLabels(points, labels, [0, 60], [0, 100]);
    const descendingResult = placeLabels(points, labels, [60, 0], [0, 100]);
    expect(descendingResult).toEqual(ascendingResult);
  });
});

describe("placeLabels — O3 review finding, round 5: log-axis-aware offsets", () => {
  it("on a log range, a weak peak's label sits a sensible LOG-SPACE distance above it (not ~2.7 decades)", () => {
    const placed = placeLabels(
      [{ x: 10, y: 10 }, { x: 30, y: 100000 }],
      ["a", "b"],
      [0, 60],
      [1, 100000],
      "log",
    );
    expect(Number.isFinite(placed[0].y)).toBe(true);
    expect(placed[0].y).toBeGreaterThan(10); // above its own apex
    const decadesAbove = Math.log10(placed[0].y) - Math.log10(10);
    // A sensible visual gap in LOG space (a fraction of a decade), not the
    // old bug's ~2.7 decades (y≈5010, log10(5010/10)≈2.7).
    expect(decadesAbove).toBeGreaterThan(0.01);
    expect(decadesAbove).toBeLessThan(1);
  });

  it("on a log range, the strong peak's label offset is NOT negligible (a real log-space gap, not a linear +constant lost in the scale)", () => {
    const placed = placeLabels(
      [{ x: 10, y: 10 }, { x: 30, y: 100000 }],
      ["a", "b"],
      [0, 60],
      [1, 100000],
      "log",
    );
    const decadesAway = Math.abs(Math.log10(placed[1].y) - Math.log10(100000));
    expect(decadesAway).toBeGreaterThan(0.01); // a real, visible gap on a log axis
    expect(placed[1].y).not.toBeCloseTo(100000, -1); // not indistinguishable from the peak itself
  });

  it("a zero/negative apex on a log axis falls back to linear and stays finite (never NaN/-Infinity)", () => {
    const placed = placeLabels([{ x: 10, y: 0 }], ["0.00"], [0, 60], [1, 100000], "log");
    expect(Number.isFinite(placed[0].y)).toBe(true);
    const placedNeg = placeLabels([{ x: 10, y: -5 }], ["-5.00"], [0, 60], [1, 100000], "log");
    expect(Number.isFinite(placedNeg[0].y)).toBe(true);
  });

  it("linear yScale (the default) is unaffected by the log-transform machinery", () => {
    const withDefault = placeLabels([{ x: 5, y: 50 }], ["50.00"], [0, 10], [0, 100]);
    const withExplicitLinear = placeLabels([{ x: 5, y: 50 }], ["50.00"], [0, 10], [0, 100], "linear");
    expect(withExplicitLinear).toEqual(withDefault);
  });

  it("reciprocal yScale is handled explicitly (transformed space), not silently treated as linear", () => {
    const linearResult = placeLabels([{ x: 10, y: 10 }], ["10.00"], [0, 60], [1, 100], "linear");
    const reciprocalResult = placeLabels([{ x: 10, y: 10 }], ["10.00"], [0, 60], [1, 100], "reciprocal");
    expect(Number.isFinite(reciprocalResult[0].y)).toBe(true);
    // Different offset formula -> a DIFFERENT result from plain linear
    // (proving it isn't just falling through to the linear path unnoticed).
    expect(reciprocalResult[0].y).not.toBeCloseTo(linearResult[0].y, 6);
  });
});

describe("placeLabels — P1+P2 review finding, round 6: ONE space, root cause (offsets/boxes/bounds all transformed)", () => {
  it("reciprocal: an apex with real headroom places its label ABOVE it (never below/negative)", () => {
    // apex=10 sits well inside [1,100] in TRANSFORMED (1/v) terms, unlike
    // apex values very close to the range's compressed high-v edge — there
    // is genuine room for the preferred UP direction to succeed.
    const placed = placeLabels([{ x: 10, y: 10 }], ["10.00"], [0, 60], [1, 100], "reciprocal");
    expect(Number.isFinite(placed[0].y)).toBe(true);
    expect(placed[0].y).toBeGreaterThan(10); // ABOVE its own apex
    expect(placed[0].y).toBeGreaterThan(0); // never negative
  });

  it("reciprocal: the exact round-6 pole-crossing repro (apex=500, out of range) is finite and NEVER negative", () => {
    // Round-5 code placed this at y=-21.05 — a candidate that crossed the
    // 1/v pole to the WRONG side, still `Number.isFinite`, so a bare
    // finite-only guard let it through. This apex is pathologically close
    // to the pole in transformed terms (1/500 is tiny), so — honestly —
    // the "prefer above" direction has essentially no room at ANY tier;
    // the invariant this test actually pins is the one round 6 asks for:
    // finite, and NEVER negative/pole-crossing garbage.
    const placed = placeLabels([{ x: 10, y: 500 }], ["500.00"], [0, 60], [1, 100], "reciprocal");
    expect(Number.isFinite(placed[0].y)).toBe(true);
    expect(placed[0].y).toBeGreaterThan(0);
    expect(placed[0].y).not.toBeCloseTo(-21.05, 1); // the exact old bug value
  });

  it("log: the exact round-6 repro — 4 clustered low-y peaks separate cleanly (not 3 overlapping pairs)", () => {
    // Round-5 code compared log-spaced offsets against a LINEAR-data-unit
    // box height — wildly mismatched near the low end of a wide log
    // range — exhausting capacity and collapsing this exact cluster into
    // 3 overlapping pairs. Same box height and offsets, ONE space now.
    const points = [{ x: 10, y: 5 }, { x: 10.5, y: 8 }, { x: 11, y: 20 }, { x: 11.5, y: 60 }];
    const labels = ["5", "8", "20", "60"];
    const xRange: [number, number] = [0, 60];
    const yRange: [number, number] = [1, 100000];
    const placed = placeLabels(points, labels, xRange, yRange, "log");
    for (const p of placed) expect(Number.isFinite(p.y)).toBe(true);
    assertNoOverlap(placed, labels, xRange, yRange, "log");
    // Every label sits above its own apex (plenty of headroom on this wide
    // log range for all four) and they stay in ascending apex order.
    for (let i = 0; i < placed.length; i++) expect(placed[i].y).toBeGreaterThan(points[i].y);
  });

  it("log: the capacity guarantee (up to MAX_STACK_TIERS + 1 distinct, non-overlapping labels) holds for a dense cluster too, not just linear", () => {
    const CAPACITY = MAX_STACK_TIERS + 1;
    const points = Array.from({ length: CAPACITY }, (_, i) => ({ x: 10 + i * 0.01, y: 50 }));
    const labels = points.map((_, i) => `${i}`);
    const xRange: [number, number] = [0, 60];
    const yRange: [number, number] = [1, 100000];
    const placed = placeLabels(points, labels, xRange, yRange, "log");
    assertNoOverlap(placed, labels, xRange, yRange, "log");
    expect(new Set(placed.map((p) => p.y.toFixed(9))).size).toBe(CAPACITY);
  });

  it("reciprocal: collision avoidance also runs in transformed space (two close peaks stagger, not overlap)", () => {
    const points = [{ x: 10, y: 3 }, { x: 10.2, y: 3.2 }];
    const labels = ["3.00", "3.20"];
    const xRange: [number, number] = [0, 60];
    const yRange: [number, number] = [1, 100];
    const placed = placeLabels(points, labels, xRange, yRange, "reciprocal");
    for (const p of placed) expect(Number.isFinite(p.y)).toBe(true);
    assertNoOverlap(placed, labels, xRange, yRange, "reciprocal");
  });
});
