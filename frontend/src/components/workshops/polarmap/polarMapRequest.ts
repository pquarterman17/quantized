// Polar map (pole figure) request builder: pure. Columns of chi (tilt), phi
// (azimuth) and intensity of a DataStruct -> the `/api/export/figure` body
// whose `polar.polar_map` the server renders (calc/figure_polar_map.py).
//
// Projection default: equal-area (Schmidt). OWNER DECISION 2026-11-24
// (GAP_AUDIT_9 D4); stereographic (Wulff) is the option.
//
// Column indices follow the aux-figure convention (-1 = the X column, then
// channels 0..); the wire counts [x, *channels] from 0, so `wireColumn` adds
// one. The client pre-checks the two refusals the server also makes (chi
// outside 0-90, too few points) so the message appears before a round trip;
// the server stays the authority.

import type { FigureSpec } from "../../../lib/api/figures";
import type { DataStruct } from "../../../lib/types";
import { cellValue, columnAxisLabel } from "../ternary/auxColumns";

export type PolarProjection = "equal_area" | "stereographic";
export type PolarMapKind = "heatmap" | "contour" | "both";
export type PolarMapCmap = "viridis" | "magma" | "gray" | "rdbu";

export interface PolarMapPicks {
  chi: number;
  phi: number;
  z: number;
  projection: PolarProjection;
  mode: PolarMapKind;
  cmap: PolarMapCmap;
  logZ: boolean;
}

/** Mirrors calc/polar_map.py's MIN_POINTS and 1e-6 degree chi tolerance. */
export const MIN_POLAR_POINTS = 10;
const CHI_TOL = 1e-6;

export const wireColumn = (index: number): number => index + 1;

function indexByLabel(data: DataStruct, pattern: RegExp): number | null {
  const xName = String(data.metadata?.["x_column_name"] ?? "");
  if (pattern.test(xName)) return -1;
  const i = data.labels.findIndex((l) => pattern.test(l));
  return i >= 0 ? i : null;
}

/** Initial picks: columns named chi/psi/tilt and phi/azimuth lead; otherwise
 *  the column order x, y1, y2 is read as phi, chi, intensity (the XRDML pole
 *  figure import: Phi, Psi, Intensity). The user re-picks in the panel. */
export function guessPolarPicks(data: DataStruct): PolarMapPicks {
  const chi = indexByLabel(data, /chi|psi|tilt|χ|ψ/i);
  const phi = indexByLabel(data, /phi|azim|φ/i);
  const n = data.labels.length;
  const z = data.labels.findIndex((l) => /intens|counts|cps|^i$/i.test(l));
  const dflt = { projection: "equal_area", mode: "heatmap", cmap: "viridis", logZ: false } as const;
  const pc = chi ?? 0;
  const pp = phi ?? -1;
  let pz = z >= 0 ? z : Math.min(n - 1, 1);
  if (pz === pc) pz = Math.max(0, n - 1);
  return { chi: pc, phi: pp, z: Math.max(0, pz), ...dflt };
}

export interface PolarMapBuild {
  /** null when nothing can be requested; `problem` says why. */
  spec: FigureSpec | null;
  problem: string | null;
  /** Rows left out because a pick is not a finite number. */
  dropped: number;
}

export function buildPolarMapRequest(
  data: DataStruct,
  p: PolarMapPicks,
  opts: { title: string; filename: string },
): PolarMapBuild {
  if (p.chi === p.phi || p.chi === p.z || p.phi === p.z) {
    return { spec: null, problem: "Pick three different columns for tilt, azimuth and intensity.", dropped: 0 };
  }
  let lo = Infinity;
  let hi = -Infinity;
  let kept = 0;
  for (let r = 0; r < data.time.length; r++) {
    const c = cellValue(data, p.chi, r);
    if (![c, cellValue(data, p.phi, r), cellValue(data, p.z, r)].every(Number.isFinite)) continue;
    kept++;
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  }
  const dropped = data.time.length - kept;
  if (kept < MIN_POLAR_POINTS) {
    return { spec: null, problem: `A polar map needs at least ${MIN_POLAR_POINTS} points; ${kept} rows have all three values.`, dropped };
  }
  if (lo < -CHI_TOL || hi > 90 + CHI_TOL) {
    return { spec: null, problem: `Tilt (chi) must lie in 0-90 degrees; this column spans ${lo.toPrecision(4)} to ${hi.toPrecision(4)}. Pick the tilt column.`, dropped };
  }
  return {
    problem: null,
    dropped,
    spec: {
      dataset: data,
      polar: {
        polar_map: {
          chi_col: wireColumn(p.chi),
          phi_col: wireColumn(p.phi),
          z_col: wireColumn(p.z),
          projection: p.projection,
          mode: p.mode,
          cmap: p.cmap,
          z_scale: p.logZ ? "log" : "linear",
        },
      },
      title: opts.title,
      y_label: columnAxisLabel(data, p.z),
      filename: opts.filename,
    },
  };
}
