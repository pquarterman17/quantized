// Bridge a DataStruct's 3 scattered channels (x, y, z) to a regular heatmap
// grid. Primary path hits the backend /api/plot/map route (scipy regrid, the
// golden-tested math); a pure client-side nearest-point regrid is the offline
// fallback (and what the unit tests exercise) — same pattern as plotdata.ts.

import { mapSeries } from "./api";
import type { DataStruct, MapResponse } from "./types";

// RSM_CUTS_PLAN item 16: regridNearest is documented O(nx·ny·N) brute force
// (see its doc below) -- the small fallback grid is the ONLY thing bounding
// that cost, so naively honouring a user's `mapRes` here would be a NEW
// freeze, not a fix. 200×200 over m3learning_rsm.xrdml's 465,885 points is
// ~1.9e10 operations in single-threaded JS -- a hard tab freeze strictly
// worse than the 19s backend "natural" bug this item fixes. 120 keeps the
// fallback usable (matches the coarsest backend resolution preset, see
// Inspector/MapCard.tsx's RESOLUTIONS) while still respecting a LOWER
// `mapRes` request (a user who explicitly picked 100 gets 100, not 120).
const OFFLINE_FALLBACK_MAX_RES = 120;

/** Present only when `fetchMap` degraded to the client-side regrid (backend
 *  unreachable) -- names the resolution actually used so the caller can
 *  announce the degradation instead of silently swapping in a coarser grid
 *  (RSM_CUTS_PLAN item 16). Never set on an aborted request -- an abort is
 *  intentional (a superseded fetch), not a failure worth surfacing. */
export interface MapFallback {
  reason: string;
  nx: number;
  ny: number;
}

export interface MapPayload {
  xAxis: number[];
  yAxis: number[];
  /** Row-major `[ny][nx]`; null = no value (NaN / outside the data hull). */
  zGrid: (number | null)[][];
  xLabel: string;
  xUnit: string;
  yLabel: string;
  yUnit: string;
  zLabel: string;
  zUnit: string;
  zMin: number | null;
  zMax: number | null;
  /** Set when this payload came from the offline client regrid, not the
   *  backend -- see `MapFallback`. */
  fallback?: MapFallback;
}

/** Resolve a channel index from an int index or a label string. */
function resolveKey(ds: DataStruct, key: number | string): number {
  return typeof key === "number" ? key : ds.labels.indexOf(key);
}

function column(ds: DataStruct, idx: number): number[] {
  return ds.values.map((row) => row[idx]);
}

function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = lo + ((hi - lo) * i) / (n - 1);
  return out;
}

function nearestIndex(axis: number[], v: number): number {
  // axis is monotonic-increasing & regular; round to the nearest cell.
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  if (hi === lo) return 0;
  const f = ((v - lo) / (hi - lo)) * (axis.length - 1);
  return Math.max(0, Math.min(axis.length - 1, Math.round(f)));
}

/** Pure client-side nearest-point regrid: each grid cell takes the z of the
 *  scattered point that lands nearest it (cells no point maps onto stay null).
 *  O(nx·ny·N) brute force — bounded by the small fallback grid; the backend
 *  path does the real scipy interpolation. */
export function regridNearest(
  x: number[],
  y: number[],
  z: number[],
  nx: number,
  ny: number,
): { xAxis: number[]; yAxis: number[]; zGrid: (number | null)[][] } {
  const finite = (v: number) => Number.isFinite(v);
  const xs = x.filter((_, i) => finite(x[i]) && finite(y[i]) && finite(z[i]));
  const ys = y.filter((_, i) => finite(x[i]) && finite(y[i]) && finite(z[i]));
  const zs = z.filter((_, i) => finite(x[i]) && finite(y[i]) && finite(z[i]));
  if (xs.length === 0) {
    return { xAxis: [0], yAxis: [0], zGrid: [[null]] };
  }
  const xAxis = linspace(Math.min(...xs), Math.max(...xs), nx);
  const yAxis = linspace(Math.min(...ys), Math.max(...ys), ny);
  const zGrid: (number | null)[][] = Array.from({ length: ny }, () =>
    new Array<number | null>(nx).fill(null),
  );
  // Accumulate each scattered point into its nearest cell (mean if several land
  // in the same cell), so a cell reflects the data there rather than the last write.
  const sum = Array.from({ length: ny }, () => new Array<number>(nx).fill(0));
  const cnt = Array.from({ length: ny }, () => new Array<number>(nx).fill(0));
  for (let k = 0; k < xs.length; k++) {
    const i = nearestIndex(xAxis, xs[k]);
    const j = nearestIndex(yAxis, ys[k]);
    sum[j][i] += zs[k];
    cnt[j][i] += 1;
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (cnt[j][i] > 0) zGrid[j][i] = sum[j][i] / cnt[j][i];
    }
  }
  return { xAxis, yAxis, zGrid };
}

function finiteExtent(grid: (number | null)[][]): { min: number | null; max: number | null } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (v != null && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return lo <= hi ? { min: lo, max: hi } : { min: null, max: null };
}

function fromResponse(r: MapResponse): MapPayload {
  return {
    xAxis: r.x_axis,
    yAxis: r.y_axis,
    zGrid: r.z_grid,
    xLabel: r.x.label,
    xUnit: r.x.unit,
    yLabel: r.y.label,
    yUnit: r.y.unit,
    zLabel: r.z.label,
    zUnit: r.z.unit,
    zMin: r.z.min,
    zMax: r.z.max,
  };
}

/** Build a heatmap grid from a DataStruct's chosen x/y/z channels via the client
 *  regrid (the offline fallback / test path). */
export function buildMapColumns(
  ds: DataStruct,
  xKey: number | string,
  yKey: number | string,
  zKey: number | string,
  nx = 60,
  ny = 60,
): MapPayload {
  const xi = resolveKey(ds, xKey);
  const yi = resolveKey(ds, yKey);
  const zi = resolveKey(ds, zKey);
  const { xAxis, yAxis, zGrid } = regridNearest(column(ds, xi), column(ds, yi), column(ds, zi), nx, ny);
  const { min, max } = finiteExtent(zGrid);
  return {
    xAxis,
    yAxis,
    zGrid,
    xLabel: ds.labels[xi] ?? "x",
    xUnit: ds.units[xi] ?? "",
    yLabel: ds.labels[yi] ?? "y",
    yUnit: ds.units[yi] ?? "",
    zLabel: ds.labels[zi] ?? "z",
    zUnit: ds.units[zi] ?? "",
    zMin: min,
    zMax: max,
  };
}

/** True when a dataset is a 2-D map (e.g. an XRDML reciprocal-space map): the
 *  parser flagged `metadata.is2D` and it carries the ≥3 channels the map needs
 *  (two axes + intensity). Drives import-time stage routing to the Map tab. */
export function is2DMap(ds: DataStruct): boolean {
  return ds.metadata["is2D"] === true && ds.labels.length >= 3;
}

/** True when a dataset exposes reciprocal-space columns (an RSM from XRDML). */
export function hasQSpace(labels: string[]): boolean {
  return labels.includes("Qx") && labels.includes("Qz");
}

/** x/y/z channel indices for the RSM angular vs reciprocal-space axes toggle.
 *  ``"q"`` -> (Qx, Qz, Intensity); ``"angular"`` -> (2Theta, axis1, Intensity).
 *  Returns null when the needed columns are absent. */
export function rsmAxisKeys(
  labels: string[],
  axis1Name: string,
  space: "angular" | "q",
): [number, number, number] | null {
  const z = labels.indexOf("Intensity");
  if (z < 0) return null;
  if (space === "q") {
    const qx = labels.indexOf("Qx");
    const qz = labels.indexOf("Qz");
    return qx < 0 || qz < 0 ? null : [qx, qz, z];
  }
  const tt = labels.indexOf("2Theta");
  const a1 = labels.indexOf(axis1Name);
  return tt < 0 || a1 < 0 ? null : [tt, a1, z];
}

/** Fetch a heatmap grid from the backend; fall back to client regrid offline.
 *  `signal` (RSM_CUTS_PLAN item 16) lets a caller abort a superseded request
 *  -- an abort propagates as a rejection (mirrors `plotdata.ts::fetchPlot`)
 *  rather than degrading to the offline grid, which would otherwise paint a
 *  stale/wrong map over whatever the newer, still-in-flight request will
 *  supply. Any OTHER failure (backend genuinely unreachable) degrades to
 *  `buildMapColumns`, capped at `OFFLINE_FALLBACK_MAX_RES` regardless of the
 *  requested `opts.nx`/`opts.ny` (see that constant), with `fallback` set on
 *  the result so the caller can tell the difference -- this function is
 *  pure-ish (no store import), so it reports the degradation in its return
 *  value instead of dispatching a status message itself. */
export async function fetchMap(
  ds: DataStruct,
  xKey: number | string,
  yKey: number | string,
  zKey: number | string,
  opts: { method?: string; nx?: number; ny?: number } = {},
  signal?: AbortSignal,
): Promise<MapPayload> {
  try {
    const r = await mapSeries(
      {
        dataset: ds,
        x_key: xKey,
        y_key: yKey,
        z_key: zKey,
        method: opts.method,
        nx: opts.nx,
        ny: opts.ny,
      },
      signal,
    );
    return fromResponse(r);
  } catch (err) {
    if (signal?.aborted) throw err;
    // Honour a LOWER requested resolution as-is (buildMapColumns's own 60
    // default applies when unset); only clamp DOWN past the freeze-risk cap.
    const nx = opts.nx != null ? Math.min(opts.nx, OFFLINE_FALLBACK_MAX_RES) : undefined;
    const ny = opts.ny != null ? Math.min(opts.ny, OFFLINE_FALLBACK_MAX_RES) : undefined;
    const payload = buildMapColumns(ds, xKey, yKey, zKey, nx, ny);
    return {
      ...payload,
      fallback: {
        reason: "backend unavailable",
        nx: payload.xAxis.length,
        ny: payload.yAxis.length,
      },
    };
  }
}

/** Can this dataset produce a 2-D map at all? (owner request 2026-07-25)
 *
 *  A map needs three channels — x, y and the z it colours by — so a dataset
 *  with fewer cannot make one. Defined ONCE here because two consumers now ask:
 *  `MapStage` (to decide between the canvas and its "needs 3 channels" notice)
 *  and `Stage` (to decide whether the Map TAB exists at all). Two copies of the
 *  rule would eventually disagree, and the visible symptom would be a tab that
 *  opens onto a permanent apology.
 *
 *  Deliberately capability, not history: "has a map been drawn" would be
 *  circular — you could never reach the tab to draw the first one. */
export function canRenderMap(data: DataStruct | null | undefined): boolean {
  return (data?.labels.length ?? 0) >= 3;
}
