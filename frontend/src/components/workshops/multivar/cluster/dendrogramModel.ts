// Dendrogram draw list: the one place the on-screen view decides what to draw
// from the backend geometry (`calc.stats_cluster_dendrogram`). The matplotlib
// export (`calc.figure_dendrogram.draw_dendrogram`) draws the same list; the
// shared wire fixture `tests/fixtures/wire/dendrogram.json` pins both
// (`dendrogramWire.test.ts` here, `tests/test_dendrogram_wire.py` there).
// Pure.

import type { DendrogramGeometry } from "../../../../lib/api/cluster";

/** Cluster k (1-based) takes PALETTE[(k - 1) % length]; links above the cut use ABOVE_CUT. */
export const PALETTE: readonly string[] = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#7f7f7f",
];
export const ABOVE_CUT = "#888888";
/** Leaf labels are drawn only up to this many leaves (matches the export). */
export const LEAF_LABEL_MAX = 60;

export const clusterColor = (cluster: number): string =>
  cluster <= 0 ? ABOVE_CUT : PALETTE[(cluster - 1) % PALETTE.length];

export interface DendrogramDrawList {
  links: { x: number[]; y: number[]; color: string }[];
  leaves: { x: number; color: string }[];
  cutY: number;
  xRange: [number, number];
  yRange: [number, number];
  /** Leaf row indices, left to right. */
  leafOrder: number[];
}

export function dendrogramDrawList(g: DendrogramGeometry): DendrogramDrawList {
  const top = Math.max(g.max_height, g.cut) * 1.05 || 1;
  return {
    links: g.segments.map((s) => ({ x: s.x, y: s.y, color: clusterColor(s.cluster) })),
    leaves: g.leaf_cluster.map((c, i) => ({ x: i, color: clusterColor(c) })),
    cutY: g.cut,
    xRange: [-0.6, g.n_leaves - 0.4],
    yRange: [0, top],
    leafOrder: g.leaf_order,
  };
}
