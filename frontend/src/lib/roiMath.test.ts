// Behavioural unit tests for roiMath.ts, INDEPENDENT of the frozen parity
// fixture (RSM_CUTS_PLAN item 5) — see roiMath.golden.test.ts for the
// fixture-driven cross-boundary parity sweep. These hand-computed oracles
// mirror the Python suite's own hand-built cases (test_calc_boxcut.py /
// test_calc_sectorcut.py) so both languages are held to the SAME worked
// examples, not just to each other's output.

import { describe, expect, it } from "vitest";

import type { RoiRect } from "./roi";
import {
  boxProfileLocal,
  boxStatsLocal,
  chiProfileLocal,
  sectorProfileLocal,
  wrapMask,
  type BoxCols,
  type PolarCols,
} from "./roiMath";

// ── Grid-path exactness: the SAME hand-computed 4x5 grid
// test_calc_boxcut.py's `hand_grid` fixture uses ──────────────────────────
//
// 2Theta = [10, 11, 12, 13, 14] (columns), Omega = [0, 1, 2, 3] (rows).
// Intensity = arange(20).reshape(4, 5), with cell [row=1, col=2] (value 7)
// planted as NaN, row-major flat layout (row*5+col):
//
//        col0  col1  col2  col3  col4     (2Theta: 10    11    12    13    14)
// row0:    0     1     2     3     4      (Omega=0)
// row1:    5     6    NaN    8     9      (Omega=1)
// row2:   10    11    12    13    14      (Omega=2)
// row3:   15    16    17    18    19      (Omega=3)

function handGrid(): BoxCols {
  const ttRow = [10, 11, 12, 13, 14];
  const omVals = [0, 1, 2, 3];
  const x = new Float64Array(20);
  const y = new Float64Array(20);
  const intensity = new Float64Array(20);
  let k = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      x[k] = ttRow[c]!;
      y[k] = omVals[r]!;
      intensity[k] = r === 1 && c === 2 ? NaN : r * 5 + c;
      k++;
    }
  }
  return { x, y, intensity, mapShape: [4, 5] };
}

const GRID_RECT: RoiRect = { space: "angular", x0: 11, x1: 13, y0: 1, y1: 2 };

describe("boxProfileLocal — grid path (exact, mirrors _grid_box)", () => {
  const cols = handGrid();

  it("collapse=x sum/mean/max match the hand-derived values", () => {
    const sum = boxProfileLocal(cols, GRID_RECT, { collapse: "x", reduce: "sum" })!;
    expect(Array.from(sum.x)).toEqual([11, 12, 13]);
    expect(Array.from(sum.intensity)).toEqual([17, 12, 21]); // nansum per column
    expect(Array.from(sum.counts)).toEqual([2, 1, 2]); // finite cell counts

    const mean = boxProfileLocal(cols, GRID_RECT, { collapse: "x", reduce: "mean" })!;
    expect(Array.from(mean.intensity)).toEqual([8.5, 12.0, 10.5]);

    const max = boxProfileLocal(cols, GRID_RECT, { collapse: "x", reduce: "max" })!;
    expect(Array.from(max.intensity)).toEqual([11, 12, 13]);
  });

  it("collapse=y sum/mean match the hand-derived values (transpose of collapse=x)", () => {
    const sum = boxProfileLocal(cols, GRID_RECT, { collapse: "y", reduce: "sum" })!;
    expect(Array.from(sum.x)).toEqual([1, 2]);
    expect(Array.from(sum.intensity)).toEqual([14, 36]); // nansum(6,8)=14; sum(11,12,13)=36
    expect(Array.from(sum.counts)).toEqual([2, 3]);

    const mean = boxProfileLocal(cols, GRID_RECT, { collapse: "y", reduce: "mean" })!;
    expect(Array.from(mean.intensity)).toEqual([7.0, 12.0]); // nanmean(6,8)=7; mean=12
  });

  it("angle != 0 or wrap set forces the cloud path even on a grid-shaped dataset", () => {
    // Cheaply distinguishable the same way test_grid_path_used_only_when_eligible
    // does: the cloud path emits exactly nBins points; the grid path emits one
    // point per selected column/row (3, for this rect) — a different count.
    const rotated = boxProfileLocal(cols, GRID_RECT, {
      collapse: "x",
      angle: 1.0,
      nBins: 5,
    })!;
    expect(rotated.x.length).toBe(5);

    const wrapped = boxProfileLocal(cols, GRID_RECT, {
      collapse: "x",
      wrap: "x",
      nBins: 5,
    })!;
    expect(wrapped.x.length).toBe(5);
  });

  it("an empty box returns null, not a throw (a normal state mid-drag)", () => {
    const nowhere: RoiRect = { space: "angular", x0: 1000, x1: 1001, y0: 1, y1: 2 };
    expect(boxProfileLocal(cols, nowhere)).toBeNull();
    expect(boxStatsLocal(cols, nowhere)).toBeNull();
  });
});

// ── wrapMask: the exact truth table test_calc_sectorcut.py's
// test_wrap_mask_matches_matlab_branches checks ────────────────────────────

describe("wrapMask", () => {
  const phi = new Float64Array([175.0, -175.0, -165.0, 160.0, 0.0]);

  it("wrapping sector (170 -> -170): MATLAB `(phi>=170) | (phi<-170)`", () => {
    const { mask, span } = wrapMask(phi, 170.0, -170.0);
    expect(Array.from(mask)).toEqual([1, 1, 0, 0, 0]);
    expect(span).toBeCloseTo(20.0, 9);
  });

  it("non-wrapping sector (-170 -> 170): MATLAB `(phi>=-170) & (phi<170)`", () => {
    const { mask, span } = wrapMask(phi, -170.0, 170.0);
    expect(Array.from(mask)).toEqual([0, 0, 1, 1, 1]);
    expect(span).toBeCloseTo(340.0, 9);
  });

  it("full circle (-180 -> 180): every point included", () => {
    const { mask, span } = wrapMask(phi, -180.0, 180.0);
    expect(Array.from(mask)).toEqual([1, 1, 1, 1, 1]);
    expect(span).toBeCloseTo(360.0, 9);
  });
});

// ── Box wrap: a hand-picked point set whose wraparound selection is
// verifiable by hand (mirrors test_calc_boxcut.py's wrap oracle, which uses
// a random cloud + an independently hand-written mask instead — this one is
// small enough to check by inspection) ─────────────────────────────────────

describe("boxProfileLocal / boxStatsLocal — wrap (periodic axis)", () => {
  // 2Theta (non-wrapped, [0,5]): index 3 (tt=6) is out of range.
  // Omega (wrapped, band [350,10), span=20): rebased = (omega-350) mod 360.
  //   idx0 omega=355 -> rebased=5   -> in [0,20)  -> included
  //   idx1 omega=5   -> rebased=15  -> in [0,20)  -> included
  //   idx2 omega=15  -> rebased=25  -> NOT in [0,20)
  //   idx3 omega=355 -> tt=6 excludes it regardless of the wrap test
  //   idx4 omega=200 -> rebased=210 -> NOT in [0,20)
  //   idx5 omega=358 -> rebased=8   -> in [0,20)  -> included
  const x = new Float64Array([1, 2, 3, 6, 1, 2]);
  const y = new Float64Array([355, 5, 15, 355, 200, 358]);
  const intensity = new Float64Array([10, 20, 30, 40, 50, 60]);
  const cols: BoxCols = { x, y, intensity }; // no mapShape -> cloud path always
  const rect: RoiRect = { space: "angular", x0: 0, x1: 5, y0: 350, y1: 10 };

  it("box_stats selects exactly the hand-verified 3 points", () => {
    const stats = boxStatsLocal(cols, rect, { wrap: "y" })!;
    expect(stats.n_points).toBe(3);
    expect(stats.integrated_intensity).toBeCloseTo(10 + 20 + 60, 9);
    expect(stats.wrap).toBe("y");
  });

  it("box_cut bins the selected points, with sum/mean disagreeing on the empty bin", () => {
    // Selected (x, intensity): (1,10), (2,20), (2,60). collapse=x over [0,5]
    // with 2 bins (edges 0, 2.5, 5): bin0 = [0,2.5) gets all three points
    // (x=1 and x=2 twice); bin1 = [2.5,5] gets none.
    const sum = boxProfileLocal(cols, rect, { collapse: "x", reduce: "sum", wrap: "y", nBins: 2 })!;
    expect(Array.from(sum.intensity)).toEqual([90, 0]); // empty bin -> 0 for sum
    expect(Array.from(sum.counts)).toEqual([3, 0]);

    const mean = boxProfileLocal(cols, rect, { collapse: "x", reduce: "mean", wrap: "y", nBins: 2 })!;
    expect(mean.intensity[0]).toBeCloseTo(30, 9); // (10+20+60)/3
    expect(Number.isNaN(mean.intensity[1])).toBe(true); // empty bin -> NaN for mean
  });
});

// ── Rotation: a 45-deg ridge is recovered by a rotated box and smeared by
// an axis-aligned one (mirrors test_calc_boxcut.py's ridge oracle — an
// AGGREGATE comparison, stable across the exact point set, instead of a
// single noisy bin) ─────────────────────────────────────────────────────

function ridgeCols(): BoxCols {
  // A deterministic grid (not random — no seeded-RNG dependency needed for a
  // unit test) spanning [-12, 12]^2 at 0.4 spacing: an anisotropic Gaussian
  // ridge tilted 45 deg off-axis.
  const half = 12.0;
  const step = 0.1; // fine enough to resolve a 20-bin, 3-unit-wide profile below
  const thetaRad = (45.0 * Math.PI) / 180;
  const cosT = Math.cos(thetaRad);
  const sinT = Math.sin(thetaRad);
  const sigmaLong = 6.0;
  const sigmaShort = 0.4;
  const amp = 100.0;
  const background = 1.0;

  const xs: number[] = [];
  const ys: number[] = [];
  const is_: number[] = [];
  for (let x = -half; x <= half; x += step) {
    for (let y = -half; y <= half; y += step) {
      const u = x * cosT + y * sinT; // along the ridge
      const v = -x * sinT + y * cosT; // across the ridge
      const intensity =
        background + amp * Math.exp(-0.5 * (u / sigmaLong) ** 2 - 0.5 * (v / sigmaShort) ** 2);
      xs.push(x);
      ys.push(y);
      is_.push(intensity);
    }
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), intensity: Float64Array.from(is_) };
}

describe("boxStatsLocal / boxProfileLocal — rotation (cut-ruler backend)", () => {
  const cols = ridgeCols();
  const half = 12.0;
  const rect: RoiRect = { space: "angular", x0: -half, x1: half, y0: -1.5, y1: 1.5 };

  it("a box rotated to align with the ridge integrates far more than an axis-aligned one", () => {
    const rotated = boxStatsLocal(cols, rect, { angle: 45.0 })!;
    const axisAligned = boxStatsLocal(cols, rect, { angle: 0.0 })!;
    expect(rotated.integrated_intensity).toBeGreaterThan(2.0 * axisAligned.integrated_intensity);
  });

  it("the rotated profile recovers the ridge's transverse (v=0) centre", () => {
    const profile = boxProfileLocal(cols, rect, {
      collapse: "y",
      reduce: "sum",
      nBins: 20,
      angle: 45.0,
    })!;
    let peakIdx = 0;
    for (let i = 1; i < profile.intensity.length; i++) {
      if (profile.intensity[i]! > profile.intensity[peakIdx]!) peakIdx = i;
    }
    const binWidth = 3.0 / 20;
    expect(Math.abs(profile.x[peakIdx]!)).toBeLessThanOrEqual(binWidth);
  });

  it("angle=0 explicit matches angle omitted (the backend's own default)", () => {
    const explicit = boxProfileLocal(cols, rect, { collapse: "x", reduce: "sum", nBins: 20, angle: 0.0 })!;
    const omitted = boxProfileLocal(cols, rect, { collapse: "x", reduce: "sum", nBins: 20 })!;
    expect(Array.from(explicit.intensity)).toEqual(Array.from(omitted.intensity));
    expect(Array.from(explicit.x)).toEqual(Array.from(omitted.x));
  });
});

// ── True-polar: sector/chi empty-bin -> NaN (mirrors
// test_calc_sectorcut.py's test_mean_and_sum_modes_with_an_empty_bin) ───────

describe("sectorProfileLocal — mean vs sum on an empty bin", () => {
  // Both points at qrad=1.5, phi=0 deg (qx=1.5, qz=0) -> both land in bin 0
  // of 2 over q=[1,3] (edges 1, 2, 3).
  const cols: PolarCols = {
    qx: new Float64Array([1.5, 1.5]),
    qz: new Float64Array([0, 0]),
    intensity: new Float64Array([4, 6]),
  };

  it("mode=mean: populated bin averages, empty bin -> NaN (not 0)", () => {
    const out = sectorProfileLocal(cols, { qMin: 1.0, qMax: 3.0, nBins: 2, mode: "mean" })!;
    expect(out.intensity[0]).toBeCloseTo(5.0, 9); // mean(4, 6)
    expect(out.counts[0]).toBeCloseTo(2.0, 9);
    expect(Number.isNaN(out.intensity[1])).toBe(true);
    expect(out.counts[1]).toBeCloseTo(0.0, 9);
  });

  it("mode=sum: populated bin totals, empty bin -> 0 (not NaN)", () => {
    const out = sectorProfileLocal(cols, { qMin: 1.0, qMax: 3.0, nBins: 2, mode: "sum" })!;
    expect(out.intensity[0]).toBeCloseTo(10.0, 9); // sum(4, 6)
    expect(out.intensity[1]).toBeCloseTo(0.0, 9);
  });

  it("no data in range -> null, not a throw", () => {
    expect(sectorProfileLocal(cols, { qMin: 1000.0, qMax: 1001.0 })).toBeNull();
    expect(chiProfileLocal(cols, { qMin: 1000.0, qMax: 1001.0 })).toBeNull();
  });
});

describe("chiProfileLocal — x stays monotonic across the wrap seam", () => {
  it("azimuth 170 and 190 (true) stay ordered instead of jumping 180 -> -180", () => {
    // qrad=3 at true azimuth 170 and -170 (== 190) deg.
    const toRad = (d: number) => (d * Math.PI) / 180;
    const cols: PolarCols = {
      qx: new Float64Array([3 * Math.cos(toRad(170)), 3 * Math.cos(toRad(-170))]),
      qz: new Float64Array([3 * Math.sin(toRad(170)), 3 * Math.sin(toRad(-170))]),
      intensity: new Float64Array([10, 20]),
    };
    const out = chiProfileLocal(cols, {
      qMin: 2.5,
      qMax: 3.5,
      nBins: 6,
      phiMin: 150.0,
      phiMax: -150.0,
      mode: "sum",
    })!;
    for (let i = 1; i < out.x.length; i++) expect(out.x[i]!).toBeGreaterThan(out.x[i - 1]!);
    expect(Math.max(...Array.from(out.x))).toBeGreaterThan(180.0);
  });
});
