// The ridgeline plot's wire types and vertices (plan item 20): one filled
// Gaussian-KDE curve per group, stacked. The densities come from
// `POST /api/statplots/ridgeline` (the violin's KDE); `ridgelineGeometry` builds
// the vertices `calc/statplots_ridgeline.py` builds for the matplotlib export,
// pinned to `tests/fixtures/wire/stat_ridgeline.json`
// (`Stage/statDist2Parity.test.ts`, `tests/test_stat_dist2.py`).
//
// One density scale for every group: the TALLEST peak is `overlap` row spacings
// high. The first group is the TOP row; ridges are listed in drawing order, so a
// lower ridge paints over the one above. Lazy only (the Stat Stage).

export type RidgeBw = "scott" | "silverman" | number;

export const RIDGE_PAD = 0.05;
export const RIDGE_FILL_ALPHA = 0.7;

export interface RidgelineWire {
  bw: RidgeBw;
  domain: [number, number];
  d_max: number;
  groups: { n: number; x: number[]; density: number[]; bandwidth: number }[];
}
export interface RidgelineGeometry {
  domain: [number, number];
  y_domain: [number, number];
  baselines: number[];
  ridges: { base: number; fill: [number, number][]; line: [number, number][] }[];
}

export function ridgelineGeometry(r: RidgelineWire, overlap: number): RidgelineGeometry {
  const n = r.groups.length;
  const scale = overlap / r.d_max;
  const ridges = r.groups.map((g, k) => {
    const base = n - 1 - k;
    const line = g.x.map((x, i): [number, number] => [x, base + g.density[i] * scale]);
    const fill: [number, number][] = [[line[0][0], base], ...line, [line[line.length - 1][0], base]];
    return { base, fill, line };
  });
  return {
    domain: r.domain,
    y_domain: [-RIDGE_PAD, n - 1 + overlap + RIDGE_PAD],
    baselines: ridges.map((g) => g.base),
    ridges,
  };
}
