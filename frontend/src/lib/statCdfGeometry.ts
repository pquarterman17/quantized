// The CDF plot's drawing helpers, split out of lib/statCdf.ts and re-exported
// from it with `export *` (bundle diet slice 35): the step / band / fit vertices,
// the rug ticks and the rug export wire. Only the lazy stat stages and their
// export modules call them; the entry chunk keeps the types, the rug limits and
// `sanitizeRugPick` (the plot-view sanitizer reads that one at startup).

import type { Pt, CdfWire, ResolvedRug } from "./statCdf";

/** Vertices of a right-continuous step function: level from `xLo` at `yStart`,
 *  rise to each `y[j]` at `x[j]`, level out to `xHi`. */
export function stairPath(x: readonly number[], y: readonly number[], xLo: number, xHi: number, yStart: number): Pt[] {
  const pts: Pt[] = [[xLo, yStart]];
  let prev = yStart;
  for (let j = 0; j < x.length; j++) {
    pts.push([x[j], prev], [x[j], y[j]]);
    prev = y[j];
  }
  pts.push([xHi, prev]);
  return pts;
}
export interface CdfGeometry {
  domain: [number, number];
  y_max: number;
  series: { step: Pt[]; band: Pt[] | null; fit: Pt[] | null }[];
}
/** Step path, band polygon (upper stairs, then the lower ones back) and fit
 *  polyline of every column. */
export function cdfGeometry(r: CdfWire): CdfGeometry {
  const [lo, hi] = r.domain;
  return {
    domain: r.domain,
    y_max: r.y_max,
    series: r.series.map((s) => {
      const b = s.band;
      return {
        step: stairPath(s.x, s.y, lo, hi, 0),
        band: b ? [...stairPath(s.x, b.hi, lo, hi, b.hi0), ...stairPath(s.x, b.lo, lo, hi, b.lo0).reverse()] : null,
        fit: s.fit ? s.fit.x.map((v, i): Pt => [v, s.fit!.y[i]]) : null,
      };
    }),
  };
}
/** One tick per finite value: `[x, y0, y1]`, y in axes-fraction height; column
 *  `row` spans `row * length` .. `(row + 1) * length`. */
export function rugTicks(values: readonly number[], row: number, length: number): [number, number, number][] {
  return values.filter(Number.isFinite).map((x) => [x, row * length, (row + 1) * length]);
}
/** The rug on the export wire (`RugOptions`), or undefined when off. */
export function rugWire(rug: ResolvedRug | null): { rug: ResolvedRug } | Record<string, never> {
  return rug ? { rug: { length: rug.length, opacity: rug.opacity } } : {};
}
