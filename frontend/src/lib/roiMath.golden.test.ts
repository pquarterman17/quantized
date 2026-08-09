// Cross-boundary parity: roiMath.ts reproduces the frozen RSM preview
// fixture (RSM_CUTS_PLAN item 5 — "Preview math + cross-boundary parity
// harness").
//
// Companion to ../../../tests/test_roi_preview_parity.py — both suites read
// the SAME committed roiMath.golden.json (generated once by
// tools/freeze_roi_preview_fixture.py from the REAL backend); NEITHER
// regenerates it here. The pytest side proves the fixture still matches
// what calc/boxcut.py/calc/sectorcut.py produce today (the staleness
// guard); THIS file is the actual drift check the whole item exists for —
// does the client-side preview math still agree with the backend, at
// rtol 1e-9 (same float64 arithmetic, no cross-language tolerance fudge).
//
// If this test ever goes red, that is the harness working as designed: a
// change to either side moved the two implementations apart, and it failed
// loudly here instead of showing a wrong number on screen during a drag.

import { describe, expect, it } from "vitest";

import type { CutSpace } from "./mapcuts";
import type { RoiRect } from "./roi";
import fixtureJson from "./roiMath.golden.json";
import {
  boxProfileLocal,
  boxStatsLocal,
  chiProfileLocal,
  sectorProfileLocal,
  type BoxCols,
  type BoxCollapse,
  type BoxReduce,
  type PolarCols,
  type RoiBoxStats,
  type RoiProfile,
  type SectorMode,
  type WrapAxis,
} from "./roiMath";

// ── Fixture plumbing ────────────────────────────────────────────────────

interface FixtureDataset {
  time: number[];
  values: number[][];
  labels: string[];
  units: string[];
  metadata: Record<string, unknown>;
}

interface DataStructOutput {
  time: number[];
  values: number[][];
  labels: string[];
  units: string[];
}

interface StatsOutput {
  n_points: number;
  integrated_intensity: number;
  mean_intensity: number;
  max_intensity: number;
  peak_x: number;
  peak_y: number;
  centroid_x: number;
  centroid_y: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  space: string;
  angle: number;
  wrap: string | null;
}

interface FixtureCase {
  fn: "box_cut" | "box_stats" | "sector_profile" | "chi_profile";
  dataset: string;
  params: Record<string, unknown>;
  output: DataStructOutput | StatsOutput;
}

interface Fixture {
  rtol: number;
  datasets: Record<string, FixtureDataset>;
  cases: Record<string, FixtureCase>;
}

// The JSON import is typed structurally by TS's inferred literal shape;
// re-assert it as the fixture's actual (looser, hand-authored) contract so
// the helpers below don't fight overly-narrow inferred literal types.
const fixture = fixtureJson as unknown as Fixture;
const RTOL = fixture.rtol;

/** Pull one labelled column out of a fixture dataset as a Float64Array —
 *  mirrors how a real caller (item 6's useMapRoi.ts) would pick columns out
 *  of an already-loaded DataStruct before calling into this module. */
function column(ds: FixtureDataset, label: string): Float64Array {
  const idx = ds.labels.indexOf(label);
  if (idx < 0) throw new Error(`fixture dataset has no column "${label}"`);
  const out = new Float64Array(ds.time.length);
  for (let i = 0; i < ds.time.length; i++) out[i] = ds.values[i]![idx]!;
  return out;
}

function boxCols(ds: FixtureDataset, space: CutSpace): BoxCols {
  if (space === "q") {
    return { x: column(ds, "Qx"), y: column(ds, "Qz"), intensity: column(ds, "Intensity") };
  }
  const axis1 = (ds.metadata["axis1_name"] as string | undefined) ?? "Omega";
  const mapShape = ds.metadata["map_shape"] as [number, number] | undefined;
  return {
    x: column(ds, "2Theta"),
    y: column(ds, axis1),
    intensity: column(ds, "Intensity"),
    mapShape: mapShape ?? null,
  };
}

function polarCols(ds: FixtureDataset): PolarCols {
  return { qx: column(ds, "Qx"), qz: column(ds, "Qz"), intensity: column(ds, "Intensity") };
}

/** |actual - expected| <= rtol * |expected| — same contract
 *  `np.testing.assert_allclose(..., rtol=RTOL)` (atol=0) uses on the pytest
 *  side, so both suites hold the fixture to the identical bar. */
function assertClose(actual: number, expected: number, path: string): void {
  const tol = RTOL * Math.abs(expected);
  expect(Math.abs(actual - expected), `${path}: got ${actual}, want ${expected}`).toBeLessThanOrEqual(
    tol,
  );
}

function assertProfileMatches(profile: RoiProfile | null, expected: DataStructOutput, label: string): void {
  expect(profile, `${label}: expected a profile, got null`).not.toBeNull();
  const p = profile!;
  expect(p.x.length, `${label}: x length`).toBe(expected.time.length);
  for (let i = 0; i < p.x.length; i++) {
    assertClose(p.x[i]!, expected.time[i]!, `${label}.x[${i}]`);
    assertClose(p.intensity[i]!, expected.values[i]![0]!, `${label}.intensity[${i}]`);
    assertClose(p.counts[i]!, expected.values[i]![1]!, `${label}.counts[${i}]`);
  }
}

function assertStatsMatches(stats: RoiBoxStats | null, expected: StatsOutput, label: string): void {
  expect(stats, `${label}: expected stats, got null`).not.toBeNull();
  const s = stats!;
  expect(s.n_points, `${label}.n_points`).toBe(expected.n_points);
  assertClose(s.integrated_intensity, expected.integrated_intensity, `${label}.integrated_intensity`);
  assertClose(s.mean_intensity, expected.mean_intensity, `${label}.mean_intensity`);
  assertClose(s.max_intensity, expected.max_intensity, `${label}.max_intensity`);
  assertClose(s.peak_x, expected.peak_x, `${label}.peak_x`);
  assertClose(s.peak_y, expected.peak_y, `${label}.peak_y`);
  assertClose(s.centroid_x, expected.centroid_x, `${label}.centroid_x`);
  assertClose(s.centroid_y, expected.centroid_y, `${label}.centroid_y`);
  expect(s.space, `${label}.space`).toBe(expected.space);
  expect(s.wrap, `${label}.wrap`).toBe(expected.wrap);
}

// ── The parity sweep ─────────────────────────────────────────────────────

describe("roiMath cross-boundary parity (RSM_CUTS_PLAN item 5)", () => {
  it("the fixture is committed and non-empty", () => {
    expect(Object.keys(fixture.cases).length).toBeGreaterThan(0);
    expect(Object.keys(fixture.datasets).length).toBeGreaterThan(0);
    expect(RTOL).toBe(1e-9);
  });

  for (const [name, testCase] of Object.entries(fixture.cases)) {
    it(`${name} (${testCase.fn}) matches the frozen backend output`, () => {
      const ds = fixture.datasets[testCase.dataset];
      if (!ds) throw new Error(`fixture case "${name}" references unknown dataset "${testCase.dataset}"`);
      const p = testCase.params;
      const space = (p["space"] as CutSpace | undefined) ?? "angular";
      const rect: RoiRect = {
        space,
        x0: p["x_min"] as number,
        x1: p["x_max"] as number,
        y0: p["y_min"] as number,
        y1: p["y_max"] as number,
      };

      switch (testCase.fn) {
        case "box_cut": {
          const profile = boxProfileLocal(boxCols(ds, space), rect, {
            collapse: p["collapse"] as BoxCollapse | undefined,
            reduce: p["reduce"] as BoxReduce | undefined,
            nBins: p["n_bins"] as number | undefined,
            angle: p["angle"] as number | undefined,
            wrap: (p["wrap"] as WrapAxis | undefined) ?? null,
          });
          assertProfileMatches(profile, testCase.output as DataStructOutput, name);
          break;
        }
        case "box_stats": {
          const stats = boxStatsLocal(boxCols(ds, space), rect, {
            angle: p["angle"] as number | undefined,
            wrap: (p["wrap"] as WrapAxis | undefined) ?? null,
          });
          assertStatsMatches(stats, testCase.output as StatsOutput, name);
          break;
        }
        case "sector_profile": {
          const profile = sectorProfileLocal(polarCols(ds), {
            qMin: p["q_min"] as number,
            qMax: p["q_max"] as number,
            phiMin: p["phi_min"] as number | undefined,
            phiMax: p["phi_max"] as number | undefined,
            nBins: p["n_bins"] as number | undefined,
            mode: p["mode"] as SectorMode | undefined,
          });
          assertProfileMatches(profile, testCase.output as DataStructOutput, name);
          break;
        }
        case "chi_profile": {
          const profile = chiProfileLocal(polarCols(ds), {
            qMin: p["q_min"] as number,
            qMax: p["q_max"] as number,
            phiMin: p["phi_min"] as number | undefined,
            phiMax: p["phi_max"] as number | undefined,
            nBins: p["n_bins"] as number | undefined,
            mode: p["mode"] as SectorMode | undefined,
          });
          assertProfileMatches(profile, testCase.output as DataStructOutput, name);
          break;
        }
      }
    });
  }
});
