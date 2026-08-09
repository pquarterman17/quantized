import { describe, expect, it } from "vitest";

import {
  applyRoiDrag,
  applyRulerDrag,
  classifyRoiHit,
  classifyRulerHit,
  defaultSectorBins,
  handlePositions,
  normalizeRect,
  nudgeRoi,
  polefigAxes,
  radialRulerForPeak,
  rectToPx,
  roiBoxBody,
  roiCursor,
  roiStatsBody,
  rulerBoxBody,
  rulerCorners,
  sectorFromCenter,
  type RoiRect,
  type RoiRuler,
} from "./roi";
import type { DataStruct, RsmPeak } from "./types";

const RECT: RoiRect = { space: "angular", x0: 10, x1: 20, y0: 30, y1: 40 };

const DS: DataStruct = { time: [], values: [], labels: [], units: [], metadata: {} };

describe("normalizeRect", () => {
  it("is a no-op on an already-normalized rect", () => {
    expect(normalizeRect(RECT)).toEqual(RECT);
  });
  it("sorts crossed bounds into a valid positive-size rect", () => {
    const crossed: RoiRect = { space: "angular", x0: 20, x1: 10, y0: 40, y1: 30 };
    expect(normalizeRect(crossed)).toEqual(RECT);
  });
});

describe("rectToPx", () => {
  // A trivial projector: px = data (identity), so the y-flip behaviour of a
  // REAL projector doesn't matter here — only the min/max normalization does.
  const identity = (x: number, y: number): [number, number] | null => [x, y];
  it("projects both corners and normalizes to a px bounding box", () => {
    expect(rectToPx(RECT, identity)).toEqual({ x0: 10, x1: 20, y0: 30, y1: 40 });
  });
  it("normalizes even when the projector flips an axis (mimics dataToPx's y-flip)", () => {
    const flipY = (x: number, y: number): [number, number] | null => [x, 100 - y];
    // data (x0,y0)=(10,30) -> px (10,70); data (x1,y1)=(20,40) -> px (20,60)
    // -> the px y bounds must come out normalized (60..70), not (70..60).
    expect(rectToPx(RECT, flipY)).toEqual({ x0: 10, x1: 20, y0: 60, y1: 70 });
  });
  it("returns null when either corner projects outside the plot area", () => {
    const outside = () => null;
    expect(rectToPx(RECT, outside)).toBeNull();
  });
});

describe("handlePositions", () => {
  it("returns 8 points in NW,N,NE,E,SE,S,SW,W order", () => {
    const h = handlePositions({ x0: 0, y0: 0, x1: 10, y1: 20 });
    expect(h).toEqual([
      { x: 0, y: 0 }, // NW
      { x: 5, y: 0 }, // N
      { x: 10, y: 0 }, // NE
      { x: 10, y: 10 }, // E
      { x: 10, y: 20 }, // SE
      { x: 5, y: 20 }, // S
      { x: 0, y: 20 }, // SW
      { x: 0, y: 10 }, // W
    ]);
  });
});

describe("classifyRoiHit", () => {
  const rectPx = { x0: 0, y0: 0, x1: 100, y1: 50 };
  it("prefers a handle over an edge within its tolerance", () => {
    expect(classifyRoiHit(rectPx, { x: 1, y: 1 })).toEqual({ kind: "handle", index: 0 });
  });
  it("finds the specific nearest edge, not just any edge", () => {
    // x=30/y=15 (not 50/25) so the probe doesn't land exactly on the N/W
    // edge-midpoint HANDLE, which would win on precedence instead.
    expect(classifyRoiHit(rectPx, { x: 30, y: 0 })).toEqual({ kind: "edge", edge: "n" });
    expect(classifyRoiHit(rectPx, { x: 0, y: 15 })).toEqual({ kind: "edge", edge: "w" });
  });
  it("falls back to interior, then null", () => {
    expect(classifyRoiHit(rectPx, { x: 50, y: 25 })).toEqual({ kind: "inside" });
    expect(classifyRoiHit(rectPx, { x: 500, y: 500 })).toBeNull();
  });
});

describe("roiCursor", () => {
  it("maps handle/edge/interior/null to a sensible CSS cursor", () => {
    expect(roiCursor(null)).toBe("default");
    expect(roiCursor({ kind: "inside" })).toBe("move");
    expect(roiCursor({ kind: "edge", edge: "n" })).toBe("ns-resize");
    expect(roiCursor({ kind: "edge", edge: "e" })).toBe("ew-resize");
    expect(roiCursor({ kind: "handle", index: 0 })).toBe("nwse-resize");
    expect(roiCursor({ kind: "handle", index: 2 })).toBe("nesw-resize");
    expect(roiCursor({ kind: "ruler-end", index: 0 })).toBe("crosshair");
    expect(roiCursor({ kind: "ruler-width", index: 1 })).toBe("crosshair");
  });
});

describe("applyRoiDrag", () => {
  it("translates on an interior hit", () => {
    const r = applyRoiDrag(RECT, { kind: "inside" }, 5, -3, 1, 1);
    expect(r).toEqual({ space: "angular", x0: 15, x1: 25, y0: 27, y1: 37 });
  });
  it("moves only the dragged edge", () => {
    const r = applyRoiDrag(RECT, { kind: "edge", edge: "e" }, 5, 0, 1, 1);
    expect(r).toEqual({ ...RECT, x1: 25 });
  });
  // The classic bug this function exists to prevent: dragging the LEFT edge
  // past the RIGHT edge must produce a valid (positive-width) rect, not a
  // negative-width one.
  it("re-normalizes on crossover instead of producing a negative-width rect", () => {
    const r = applyRoiDrag(RECT, { kind: "edge", edge: "w" }, 15, 0, 0, 0); // x0: 10 -> 25, past x1=20
    expect(r.x0).toBeLessThanOrEqual(r.x1);
    expect(r).toEqual({ ...RECT, x0: 20, x1: 25 });
  });
  it("crosses over on a handle drag too (NW corner past the SE corner)", () => {
    const r = applyRoiDrag(RECT, { kind: "handle", index: 0 }, 15, 15, 0, 0);
    expect(r.x0).toBeLessThanOrEqual(r.x1);
    expect(r.y0).toBeLessThanOrEqual(r.y1);
  });
  it("never shrinks below the minimum size", () => {
    const r = applyRoiDrag(RECT, { kind: "edge", edge: "e" }, -9, 0, 5, 1); // width would be 1
    expect(r.x1 - r.x0).toBeCloseTo(5, 6);
  });
  it("is a no-op for a ruler-only hit or a null hit", () => {
    expect(applyRoiDrag(RECT, { kind: "ruler-end", index: 0 }, 5, 5, 1, 1)).toEqual(RECT);
    expect(applyRoiDrag(RECT, null, 5, 5, 1, 1)).toEqual(RECT);
  });
});

describe("nudgeRoi", () => {
  it("translates by step in the given direction (up/right positive)", () => {
    expect(nudgeRoi(RECT, "up", 2)).toEqual({ ...RECT, y0: 32, y1: 42 });
    expect(nudgeRoi(RECT, "right", 2)).toEqual({ ...RECT, x0: 12, x1: 22 });
    expect(nudgeRoi(RECT, "down", 2)).toEqual({ ...RECT, y0: 28, y1: 38 });
    expect(nudgeRoi(RECT, "left", 2)).toEqual({ ...RECT, x0: 8, x1: 18 });
  });
});

const RULER: RoiRuler = { space: "q", cx: 0, cy: 0, angle: 0, length: 10, width: 4 };

describe("rulerCorners", () => {
  it("computes the 4 corners of an unrotated ruler", () => {
    const c = rulerCorners(RULER);
    expect(c[0]!.x).toBeCloseTo(5, 6); // end A (+u), +width side
    expect(c[0]!.y).toBeCloseTo(2, 6);
    expect(c[1]!.x).toBeCloseTo(5, 6); // end A, -width side
    expect(c[1]!.y).toBeCloseTo(-2, 6);
    expect(c[2]!.x).toBeCloseTo(-5, 6); // end B
    expect(c[3]!.x).toBeCloseTo(-5, 6);
  });
  it("rotates the corners with the angle (90deg swaps length/width axes)", () => {
    const c = rulerCorners({ ...RULER, angle: 90 });
    // At 90deg, "length" runs along +y and "width" along -x: end A (the
    // midpoint of corners 0/1) moves to (0, 5), not (5, 0).
    const endA = { x: (c[0]!.x + c[1]!.x) / 2, y: (c[0]!.y + c[1]!.y) / 2 };
    expect(endA.x).toBeCloseTo(0, 6);
    expect(endA.y).toBeCloseTo(5, 6);
  });
});

describe("classifyRulerHit", () => {
  const corners = rulerCorners(RULER); // unrotated, so corners are px-identity here
  it("finds the end/width handles", () => {
    expect(classifyRulerHit(corners, { x: 5, y: 0 })).toEqual({ kind: "ruler-end", index: 0 });
    expect(classifyRulerHit(corners, { x: -5, y: 0 })).toEqual({ kind: "ruler-end", index: 1 });
    expect(classifyRulerHit(corners, { x: 0, y: -2 })).toEqual({ kind: "ruler-width", index: 0 });
    expect(classifyRulerHit(corners, { x: 0, y: 2 })).toEqual({ kind: "ruler-width", index: 1 });
  });
  it("falls back to interior, then null", () => {
    // RULER is only 4 units wide (hw=2), so its own centre sits within the
    // default 7px handle tolerance of the width handles — use a bigger
    // ruler so the centre genuinely lands in the interior, not a handle.
    const big = rulerCorners({ ...RULER, length: 100, width: 40 });
    expect(classifyRulerHit(big, { x: 0, y: 0 })).toEqual({ kind: "inside" });
    expect(classifyRulerHit(big, { x: 500, y: 500 })).toBeNull();
  });
});

describe("applyRulerDrag", () => {
  it("translates the centre on an interior hit", () => {
    const r = applyRulerDrag(RULER, { kind: "inside" }, 3, 4, 1, 1);
    expect(r).toEqual({ ...RULER, cx: 3, cy: 4 });
  });
  it("dragging one end keeps the OTHER end fixed and updates length/angle", () => {
    // Drag end 1 (endB, originally at -5,0) straight down by 5 -> new endB
    // at (-5,5); endA (5,0) must stay EXACTLY put.
    const r = applyRulerDrag(RULER, { kind: "ruler-end", index: 1 }, 0, 5, 0, 0);
    const after = rulerCorners(r);
    // endA is the midpoint of corners 0/1 of the result.
    const endAAfter = { x: (after[0]!.x + after[1]!.x) / 2, y: (after[0]!.y + after[1]!.y) / 2 };
    expect(endAAfter.x).toBeCloseTo(5, 6);
    expect(endAAfter.y).toBeCloseTo(0, 6);
    expect(r.length).toBeCloseTo(Math.hypot(10, 5), 6);
  });
  it("never shrinks length below the minimum", () => {
    const r = applyRulerDrag(RULER, { kind: "ruler-end", index: 0 }, -20, 0, 3, 0); // would cross to ~-10
    expect(r.length).toBeGreaterThanOrEqual(3);
  });
  it("width handles grow/shrink symmetrically about the centreline", () => {
    const r = applyRulerDrag(RULER, { kind: "ruler-width", index: 0 }, 0, -1, 0, 0); // width0 at y=-2, drag further -1
    expect(r.width).toBeCloseTo(6, 6); // +2 total (symmetric)
    expect(r.cx).toBeCloseTo(RULER.cx, 6); // centre unmoved
  });
  it("never shrinks width below the minimum", () => {
    const r = applyRulerDrag(RULER, { kind: "ruler-width", index: 0 }, 0, 10, 2, 2); // pushes inward past centre
    expect(r.width).toBeGreaterThanOrEqual(2);
  });
  it("is a no-op for a rect-only hit", () => {
    expect(applyRulerDrag(RULER, { kind: "edge", edge: "n" }, 5, 5, 1, 1)).toEqual(RULER);
  });
});

describe("sectorFromCenter", () => {
  // Explicit pass-through requirement (Resolved decisions): the backend
  // owns the mod-360 rebase, so this must NOT wrap into [-180, 180].
  it("does not wrap a sector that straddles the +-180 seam", () => {
    expect(sectorFromCenter(170, 20)).toEqual({ phiMin: 150, phiMax: 190 });
    expect(sectorFromCenter(-170, 20)).toEqual({ phiMin: -190, phiMax: -150 });
  });
  it("is a plain center +- halfwidth otherwise", () => {
    expect(sectorFromCenter(0, 30)).toEqual({ phiMin: -30, phiMax: 30 });
  });
});

describe("defaultSectorBins", () => {
  it("clamps round(max/2) into [20, 200]", () => {
    expect(defaultSectorBins([64, 96])).toBe(48); // round(96/2)
    expect(defaultSectorBins([10, 10])).toBe(20); // clamped up
    expect(defaultSectorBins([1000, 1000])).toBe(200); // clamped down
  });
  it("falls back to 100 (sector_profile's own default) with no map_shape", () => {
    expect(defaultSectorBins(null)).toBe(100);
    expect(defaultSectorBins([])).toBe(100);
  });
});

describe("polefigAxes", () => {
  it("detects a near-full-circle Phi axis", () => {
    expect(polefigAxes({ label: "Phi", span: 358 }, { label: "Psi", span: 40 })).toBe("x");
    expect(polefigAxes({ label: "Chi", span: 20 }, { label: "Phi", span: 360 })).toBe("y");
  });
  it("is case-insensitive and requires the span threshold", () => {
    expect(polefigAxes({ label: "phi", span: 349.9 }, { label: "Psi", span: 40 })).toBeNull();
  });
  it("returns null for a non-polar pair, or when BOTH qualify (ambiguous)", () => {
    expect(polefigAxes({ label: "2Theta", span: 10 }, { label: "Omega", span: 5 })).toBeNull();
    expect(polefigAxes({ label: "Phi", span: 360 }, { label: "Psi", span: 360 })).toBeNull();
  });
});

describe("radialRulerForPeak", () => {
  const peak: RsmPeak = {
    rank: 1,
    classification: "film",
    centre_angle: [30, 60],
    centre_Q: [1, 1], // |Q| = sqrt(2), atan2(1,1) = 45deg
    fwhm_angle: [0.1, 0.1],
    fwhm_Q: [0.01, 0.01],
    amplitude: 10,
    background: 0,
  };
  it("radial: angle along atan2(qz,qx)", () => {
    const r = radialRulerForPeak(peak, "radial", 2);
    expect(r).not.toBeNull();
    expect(r!.angle).toBeCloseTo(45, 6);
    expect(r!.cx).toBe(1);
    expect(r!.cy).toBe(1);
    expect(r!.length).toBeCloseTo(0.3 * Math.SQRT2, 6);
    expect(r!.width).toBe(6); // 3 * gridCell(2)
  });
  it("transverse: +90deg from radial", () => {
    const r = radialRulerForPeak(peak, "transverse");
    expect(r!.angle).toBeCloseTo(135, 6);
  });
  it("returns null without Q-space coordinates", () => {
    const noQ = { ...peak, centre_Q: [null, null] as [number | null, number | null] };
    expect(radialRulerForPeak(noQ, "radial")).toBeNull();
  });
});

describe("request shapers", () => {
  it("roiBoxBody applies collapse/reduce defaults and echoes the rect bounds", () => {
    expect(roiBoxBody(DS, RECT)).toMatchObject({
      x_min: 10,
      x_max: 20,
      y_min: 30,
      y_max: 40,
      space: "angular",
      collapse: "x",
      reduce: "sum",
    });
    expect(roiBoxBody(DS, RECT, { collapse: "y", nBins: 50 })).toMatchObject({
      collapse: "y",
      n_bins: 50,
    });
  });
  it("rulerBoxBody derives bounds+angle about the ruler's centre", () => {
    expect(rulerBoxBody(DS, RULER)).toMatchObject({
      x_min: -5,
      x_max: 5,
      y_min: -2,
      y_max: 2,
      space: "q",
      angle: 0,
    });
  });
  it("roiStatsBody echoes bounds without collapse/reduce/n_bins", () => {
    const body = roiStatsBody(DS, RECT, { angle: 15 });
    expect(body).toMatchObject({ x_min: 10, x_max: 20, y_min: 30, y_max: 40, angle: 15 });
    expect(body).not.toHaveProperty("collapse");
    expect(body).not.toHaveProperty("n_bins");
  });
});
