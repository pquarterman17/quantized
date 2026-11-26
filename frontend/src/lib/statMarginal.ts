// The marginal plot's wire types and vertices (plan item 20): a scatter with the
// distribution of each axis along its top and right. The numbers come from
// `POST /api/statplots/marginal`; `marginalGeometry` only turns them into the
// vertices `calc/statplots_marginal.py` builds for the matplotlib export. Both
// are pinned to `tests/fixtures/wire/stat_marginal.json`
// (`Stage/statDist2Parity.test.ts`, `tests/test_stat_dist2.py`).
//
// Strip coordinates: ALONG a strip the axis is data units; ACROSS it 0..1 from
// the edge touching the scatter outward. Lazy only (the Stat Stage).

export type MarginalKind = "histogram" | "box" | "rug";

/** The strips' share of the plot area (each way) and the gap, as in the export. */
export const MARGINAL_RATIO = 0.2;
export const MARGINAL_GAP = 0.02;
export const MARGINAL_HIST_PEAK = 0.9;
export const MARGINAL_BOX_BAND: [number, number] = [0.25, 0.75];
const RUG_BAND = [0, 0.5] as const;

export interface MarginalDistribution {
  edges?: number[];
  counts?: number[];
  q1?: number;
  median?: number;
  q3?: number;
  whislo?: number;
  whishi?: number;
  fliers?: number[];
}
export interface MarginalWire {
  kind: MarginalKind;
  n: number;
  x: number[];
  y: number[];
  domain: { x: [number, number]; y: [number, number] };
  marginals: { x: MarginalDistribution; y: MarginalDistribution };
}
export type MarginalStrip =
  | { kind: "histogram"; bars: [number, number, number][] }
  | { kind: "box"; box: [number, number]; median: number; whiskers: [number, number]; fliers: number[] }
  | { kind: "rug"; ticks: [number, number, number][] };
export interface MarginalGeometry {
  domain: MarginalWire["domain"];
  points: [number, number][];
  strips: { x: MarginalStrip; y: MarginalStrip };
}

function strip(kind: MarginalKind, m: MarginalDistribution, values: number[]): MarginalStrip {
  if (kind === "histogram") {
    const counts = m.counts!;
    const top = Math.max(...counts) || 1;
    return { kind, bars: counts.map((c, i): [number, number, number] => [m.edges![i], m.edges![i + 1], (MARGINAL_HIST_PEAK * c) / top]) };
  }
  if (kind === "box") {
    return { kind, box: [m.q1!, m.q3!], median: m.median!, whiskers: [m.whislo!, m.whishi!], fliers: m.fliers ?? [] };
  }
  return { kind, ticks: values.map((v): [number, number, number] => [v, RUG_BAND[0], RUG_BAND[1]]) };
}

export function marginalGeometry(r: MarginalWire): MarginalGeometry {
  return {
    domain: r.domain,
    points: r.x.map((v, i): [number, number] => [v, r.y[i]]),
    strips: { x: strip(r.kind, r.marginals.x, r.x), y: strip(r.kind, r.marginals.y, r.y) },
  };
}
