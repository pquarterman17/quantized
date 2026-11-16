// Covers BOTH halves of the C2 eager/lazy split: `mapdata.ts` (eager
// detection half) and `mapdataFetch.ts` (lazy fetch/grid half).
import { describe, expect, it, vi } from "vitest";

import { canRenderMap, ensureMapGate, is2DMap, mapGateVersion } from "./mapdata";
import { mapGateWork } from "./mapGate";

import {
  buildMapColumns,
  defaultMapKeys,
  mapColumns,
  fetchMap,
  hasQSpace,
  regridNearest,
  rsmAxisKeys,
} from "./mapdataFetch";
import type { DataStruct } from "./types";

/** canRenderMap is fail-closed until the lazy grid gate has resolved for the data. */
const mappable = async (d: DataStruct): Promise<boolean> => {
  await ensureMapGate(d);
  return canRenderMap(d);
};

vi.mock("./api", () => ({
  mapSeries: vi.fn(() => Promise.reject(new Error("offline"))),
}));

describe("regridNearest", () => {
  it("bins corner points onto their own cells (row-major [ny][nx])", async () => {
    const x = [0, 1, 0, 1];
    const y = [0, 0, 1, 1];
    const z = [1, 2, 3, 4];
    const { xAxis, yAxis, zGrid } = regridNearest(x, y, z, 2, 2);
    expect(xAxis).toEqual([0, 1]);
    expect(yAxis).toEqual([0, 1]);
    // row j=0 is y=0 (z 1,2); row j=1 is y=1 (z 3,4).
    expect(zGrid).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("leaves cells with no nearest point as null", async () => {
    // One point in a 3×3 grid -> exactly one filled cell, the rest null.
    const { zGrid } = regridNearest([0.5], [0.5], [9], 3, 3);
    const filled = zGrid.flat().filter((v) => v != null);
    expect(filled).toEqual([9]);
  });

  it("averages multiple points landing in the same cell", async () => {
    // Two points near the same corner of a 2×2 grid -> mean of their z.
    const { zGrid } = regridNearest([0, 0.01, 1], [0, 0.01, 1], [10, 20, 5], 2, 2);
    expect(zGrid[0][0]).toBe(15); // mean(10, 20)
    expect(zGrid[1][1]).toBe(5);
  });

  it("returns a 1×1 null grid when all input is non-finite", async () => {
    expect(regridNearest([NaN], [NaN], [NaN], 4, 4)).toEqual({
      xAxis: [0],
      yAxis: [0],
      zGrid: [[null]],
    });
  });
});

function _ds(): DataStruct {
  return {
    time: [0, 1, 2, 3],
    values: [
      [0, 0, 1],
      [1, 0, 2],
      [0, 1, 3],
      [1, 1, 4],
    ],
    labels: ["Qx", "Qz", "I"],
    units: ["1/A", "1/A", "cps"],
    metadata: {},
  };
}

describe("buildMapColumns", () => {
  it("carries the chosen channels' labels/units and z range", async () => {
    const p = buildMapColumns(_ds(), 0, 1, 2, 2, 2);
    expect(p.xLabel).toBe("Qx");
    expect(p.yLabel).toBe("Qz");
    expect(p.zLabel).toBe("I");
    expect(p.zUnit).toBe("cps");
    expect(p.zMin).toBe(1);
    expect(p.zMax).toBe(4);
  });

  it("resolves channels by label too", async () => {
    const p = buildMapColumns(_ds(), "Qx", "Qz", "I", 2, 2);
    expect(p.zGrid).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("fetchMap", () => {
  it("falls back to the client regrid when the backend is unavailable", async () => {
    const p = await fetchMap(_ds(), 0, 1, 2, { nx: 2, ny: 2 });
    expect(p.zGrid).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(p.zMin).toBe(1);
    expect(p.zMax).toBe(4);
  });

  // RSM_CUTS_PLAN item 16.
  it("marks a degraded payload with the resolution actually used", async () => {
    const p = await fetchMap(_ds(), 0, 1, 2, { nx: 2, ny: 2 });
    expect(p.fallback).toEqual({ reason: "backend unavailable", nx: 2, ny: 2 });
  });

  it("caps the fallback grid at 120 even when a much larger mapRes was requested", async () => {
    // Naively honouring a large mapRes here would be a NEW freeze (the
    // fallback is O(nx*ny*N) brute force) -- see OFFLINE_FALLBACK_MAX_RES.
    const p = await fetchMap(_ds(), 0, 1, 2, { nx: 400, ny: 400 });
    expect(p.fallback).toEqual({ reason: "backend unavailable", nx: 120, ny: 120 });
    expect(p.zGrid.length).toBe(120);
    expect(p.zGrid[0].length).toBe(120);
  });

  it("honours a requested resolution below the cap exactly", async () => {
    const p = await fetchMap(_ds(), 0, 1, 2, { nx: 40, ny: 40 });
    expect(p.fallback).toEqual({ reason: "backend unavailable", nx: 40, ny: 40 });
  });

  it("does NOT degrade to the offline grid on an aborted request", async () => {
    // An abort is intentional (a superseded fetch, e.g. the 2θ/ω <-> Q
    // toggle) -- it must propagate as a rejection, never a silent, possibly
    // stale offline grid with no `fallback` marker (see fetchMap's doc).
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchMap(_ds(), 0, 1, 2, { nx: 2, ny: 2 }, controller.signal),
    ).rejects.toThrow();
  });
});

// An RSM DataStruct from import_xrdml: [2Theta, Omega, Intensity, Qx, Qz].
const _RSM_LABELS = ["2Theta", "Omega", "Intensity", "Qx", "Qz"];

describe("is2DMap", () => {
  const mk = (metadata: Record<string, unknown>, labels: string[]): DataStruct => ({
    time: [],
    values: [],
    labels,
    units: labels.map(() => ""),
    metadata,
  });

  it("is true for an is2D dataset with ≥3 channels", async () => {
    expect(is2DMap(mk({ is2D: true }, ["2Theta", "Omega", "Intensity"]))).toBe(true);
  });

  it("is false without the is2D flag (a 1-D scan)", async () => {
    expect(is2DMap(mk({}, ["T", "M"]))).toBe(false);
    expect(is2DMap(mk({ is2D: false }, ["2Theta", "Omega", "Intensity"]))).toBe(false);
  });

  it("is false when flagged 2-D but with too few channels to map", async () => {
    expect(is2DMap(mk({ is2D: true }, ["x", "y"]))).toBe(false);
  });
});

describe("hasQSpace", () => {
  it("is true only when both Qx and Qz columns exist", async () => {
    expect(hasQSpace(_RSM_LABELS)).toBe(true);
    expect(hasQSpace(["2Theta", "Omega", "Intensity"])).toBe(false);
    expect(hasQSpace(["Qx", "Intensity"])).toBe(false);
  });
});

describe("rsmAxisKeys", () => {
  it("maps angular -> (2Theta, axis1, Intensity)", async () => {
    expect(rsmAxisKeys(_RSM_LABELS, "Omega", "angular")).toEqual([0, 1, 2]);
  });
  it("maps q -> (Qx, Qz, Intensity)", async () => {
    expect(rsmAxisKeys(_RSM_LABELS, "Omega", "q")).toEqual([3, 4, 2]);
  });
  it("honours a non-Omega secondary axis name", async () => {
    const labels = ["2Theta", "Chi", "Intensity", "Qx", "Qz"];
    expect(rsmAxisKeys(labels, "Chi", "angular")).toEqual([0, 1, 2]);
  });
  it("returns null when required columns are missing", async () => {
    expect(rsmAxisKeys(["2Theta", "Omega", "Intensity"], "Omega", "q")).toBeNull();
    expect(rsmAxisKeys(["Qx", "Qz"], "Omega", "q")).toBeNull(); // no Intensity
  });
});

describe("map columns + tab gating (figures-audit #13)", () => {
  // Plain long-form X,Y,Z CSV: X is the file's first column, so it lands in
  // `time`, leaving only two channels.
  function xyz(): DataStruct {
    const time: number[] = [];
    const values: number[][] = [];
    for (const x of [0, 1, 2]) for (const y of [0, 1, 2]) {
      time.push(x);
      values.push([y, x * 10 + y]);
    }
    return { time, values, labels: ["Y", "Z"], units: ["", ""], metadata: { x_column_name: "X" } };
  }

  it("offers a map for long-form XYZ even with only two channels, picking the first column too", async () => {
    expect(await mappable(xyz())).toBe(true);
    const cols = mapColumns(xyz());
    expect(cols.labels).toEqual(["X", "Y", "Z"]);
    expect(cols.values[4]).toEqual([1, 1, 11]);
    expect(defaultMapKeys(xyz())).toEqual([0, 1, 2]);
  });

  it("starts an i,X,Y,Z file (row-index first column) on X/Y/Z, not i/X/Y", async () => {
    const d = xyz();
    const idx: DataStruct = { ...d, time: d.time.map((_, k) => k), values: d.values.map((r, k) => [d.time[k], ...r]), labels: ["X", "Y", "Z"], units: ["", "", ""] };
    expect(await mappable(idx)).toBe(true);
    expect(defaultMapKeys(idx)).toEqual([1, 2, 3]);
  });

  it("does not offer a map for a 1-D sweep (swept axis + continuous signals)", async () => {
    const n = 20;
    const sweep: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i * 0.1),
      values: Array.from({ length: n }, (_, i) => [Math.sin(i), Math.cos(i), i * i]),
      labels: ["S0", "S1", "S2"],
      units: ["", "", ""],
      metadata: {},
    };
    expect(await mappable(sweep)).toBe(false);
  });

  it("does not offer a map for an instrument sweep whose step-valued status columns merely repeat (MPMS M(T))", async () => {
    // Real mpms_mvst.dat: Range(2), Motor Current(37), Motor Temp(8), Temp. Status(3)
    // all repeat, but their pairs fill a sliver of the cross product -- not a grid.
    const n = 300;
    const i = Array.from({ length: n }, (_, k) => k);
    const d: DataStruct = {
      time: i.map((k) => 1000 + k * 1.37),
      values: i.map((k) => [Math.sin(k / 9), k < 150 ? 0 : 1, Math.floor(k / 8) * 0.5, Math.floor(k / 40), Math.floor(k / 100)]),
      labels: ["Moment", "Range", "Motor Current", "Motor Temp.", "Temp. Status"],
      units: ["", "", "", "", ""],
      metadata: {},
    };
    expect(await mappable(d)).toBe(false);
  });

  // ---- UX-D: grid gate edge cases (coverage, line regularity, 2-level, cost) ----
  const longForm = (pts: [number, number, number][]): DataStruct => ({
    time: pts.map((p) => p[0]),
    values: pts.map((p) => [p[1], p[2]]),
    labels: ["Y", "Z"],
    units: ["", ""],
    metadata: { x_column_name: "X" },
  });
  const raster = (nx: number, ny: number, f: (i: number, j: number) => [number, number]): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const [x, y] = f(i, j); pts.push([x, y, i * j]); }
    return pts;
  };

  it("a regular grid with one cell missing, or an aborted last line, is still a map", async () => {
    const full = raster(6, 6, (i, j) => [i, j]);
    expect(await mappable(longForm(full.filter((_, k) => k !== 7)))).toBe(true);
    expect(await mappable(longForm(full.slice(0, 6 * 5 + 2)))).toBe(true); // scan stopped mid-line
  });

  it("scattered points on a coarse lattice (about half the cells) are NOT a map", async () => {
    const hash = (k: number): number => { const v = Math.sin(k * 12.9898) * 43758.5453; return v - Math.floor(v); };
    const pts = raster(10, 10, (i, j) => [i, j]).filter((_, k) => hash(k) < 0.5);
    expect(await mappable(longForm(pts))).toBe(false);
  });

  it("a 2 x N table is not a map (an axis needs 3 levels and lines need 3 points)", async () => {
    expect(await mappable(longForm(raster(2, 8, (i, j) => [i, j])))).toBe(false);
    expect(await mappable(longForm(raster(8, 2, (i, j) => [i, j])))).toBe(false);
    expect(await mappable(longForm(raster(3, 3, (i, j) => [i, j])))).toBe(true);
  });

  it("a sheared grid (coupled omega-2theta RSM as long-form CSV) is a map", async () => {
    // omega = offset + 2theta/2 (integers, so equal values are equal floats): ~17 % of the omega x 2theta cross product is occupied
    const pts = raster(21, 41, (i, j) => [i + j, j]);
    expect(await mappable(longForm(pts))).toBe(true);
  });

  it("a staggered (hex) raster is a map", async () => {
    expect(await mappable(longForm(raster(12, 12, (i, j) => [i + (j % 2) * 0.5, j])))).toBe(true);
  });

  it("an encoder-noisy fast axis (2 readback values per nominal step) is still a map", async () => {
    expect(await mappable(longForm(raster(12, 12, (i, j) => [i + (j % 2) * 1e-3, j])))).toBe(true);
  });

  it("a stepped profile whose 'fast' column is barely revisited (each value in < 3 rows) is NOT a map", async () => {
    // nbau_pnr-0-steps.dat shape: a staircase column beside a monotone profile
    // axis whose values are used by ~2.5 rows each -- uniform monotone lines, but
    // the "fast" axis does not recur across lines like a raster's does.
    const pts: [number, number, number][] = [];
    for (let line = 0; line < 30; line++) for (let j = 0; j < 5; j++) pts.push([2 * line + j, line * 0.01, 0]);
    expect(await mappable(longForm(pts))).toBe(false);
    // the same lines with the profile axis shared by more lines (step 1) ARE a sheared raster
    const sheared: [number, number, number][] = [];
    for (let line = 0; line < 30; line++) for (let j = 0; j < 5; j++) sheared.push([line + j, line * 0.01, 0]);
    expect(await mappable(longForm(sheared))).toBe(true);
  });

  it("is fail-closed until the lazy gate resolves, then memoised per dataset (computed once)", async () => {
    const d = longForm(raster(6, 6, (i, j) => [i, j]));
    expect(canRenderMap(d)).toBe(false); // nothing known yet: no Map tab
    const v = mapGateVersion();
    const scans = mapGateWork.pairScans;
    expect(await ensureMapGate(d)).toBe(true);
    expect(canRenderMap(d)).toBe(true);
    expect(mapGateVersion()).toBe(v + 1); // subscribers are told
    const after = mapGateWork.pairScans;
    expect(after).toBeGreaterThan(scans);
    expect(await ensureMapGate(d)).toBe(true);
    expect(mapGateWork.pairScans).toBe(after); // cached: no second scan
  });

  it("parser-flagged 2-D maps keep the tab immediately, with no lazy wait", () => {
    const rsm: DataStruct = { time: [0, 1, 2, 3], values: [[0, 1, 2], [1, 2, 3], [2, 3, 4], [3, 4, 5]], labels: ["a", "b", "c"], units: ["", "", ""], metadata: { is2D: true } };
    expect(canRenderMap(rsm)).toBe(true);
  });

  it("does the pair work only for pairs that can qualify, on a bounded sample (perf invariant)", async () => {
    // 10 monotone step-valued status columns over 300k rows: nothing here is a grid.
    const n = 300_000;
    const values = Array.from({ length: n }, (_, r) => Array.from({ length: 10 }, (_, c) => Math.floor(r / (4000 + c * 900))));
    const d: DataStruct = {
      time: Array.from({ length: n }, (_, r) => r * 0.01),
      values,
      labels: Array.from({ length: 10 }, (_, c) => `S${c}`),
      units: Array(10).fill(""),
      metadata: {},
    };
    const before = { ...mapGateWork };
    expect(await mappable(d)).toBe(false);
    const scans = mapGateWork.pairScans - before.pairScans;
    const rows = mapGateWork.pairRows - before.pairRows;
    expect(scans).toBeLessThanOrEqual(28); // C(8,2): the candidate cap
    expect(rows).toBeLessThanOrEqual(28 * 20_000); // each scan sees <= the 20k-row sample, never 300k
  });

  it("scans no pairs at all when fewer than two columns repeat like axes", async () => {
    const n = 50;
    const d: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [Math.sin(i), i * i]),
      labels: ["A", "B"],
      units: ["", ""],
      metadata: {},
    };
    const before = mapGateWork.pairScans;
    expect(await mappable(d)).toBe(false);
    expect(mapGateWork.pairScans).toBe(before);
  });

  it("never guesses scattered XYZ: ordinary 3-column magnetometry data gets no Map tab", async () => {
    const n = 40;
    const mk = (time: number[], a: number[], b: number[]): DataStruct => ({
      time, values: a.map((v, i) => [v, b[i]]), labels: ["A", "B"], units: ["", ""], metadata: {},
    });
    const up = Array.from({ length: n }, (_, i) => -100 + (200 * i) / (n - 1));
    const loopH = [...up, ...[...up].reverse()];
    const loopM = loopH.map((h, i) => Math.tanh(h / 30) + (i < n ? -0.1 : 0.1));
    // hysteresis loop: H, M, dM (X goes up and back, M is non-monotonic)
    expect(await mappable(mk(loopH, loopM, loopM.map((m) => m * 0.01)))).toBe(false);
    // M(T) cooling sweep with jitter in the measured temperature
    const temp = Array.from({ length: n }, (_, i) => 300 - i * 5 + Math.sin(i * 12.9) * 0.4);
    expect(await mappable(mk(temp, temp.map((t, i) => 1 / t + (i % 2) * 1e-4), temp.map((t) => t / 100)))).toBe(false);
    // a time series with a NaN hole in each of two columns
    const t = Array.from({ length: n }, (_, i) => i);
    const y = t.map((v) => v * 2);
    y[5] = Number.NaN;
    const tNaN = [...t];
    tNaN[7] = Number.NaN;
    expect(await mappable(mk(tNaN, y, t.map((v) => v * v)))).toBe(false);
  });

  it("offers a Map tab for scattered XYZ once the user opted in (metadata.scatteredXYZ)", async () => {
    const n = 30;
    const px = Array.from({ length: n }, (_, i) => (i * 7919) % 31);
    const py = Array.from({ length: n }, (_, i) => (i * 104729) % 29);
    const scattered: DataStruct = {
      time: px, values: px.map((x, i) => [py[i], x + py[i]]), labels: ["Y", "Z"], units: ["", ""], metadata: {},
    };
    expect(await mappable(scattered)).toBe(false);
    expect(await mappable({ ...scattered, metadata: { scatteredXYZ: true } })).toBe(true);
  });

  it("keeps a parser-flagged 2-D map's own channels (its ROI tools index them)", async () => {
    const rsm: DataStruct = { ..._ds(), metadata: { is2D: true } };
    expect(await mappable(rsm)).toBe(true);
    expect(mapColumns(rsm)).toBe(rsm);
  });
});
