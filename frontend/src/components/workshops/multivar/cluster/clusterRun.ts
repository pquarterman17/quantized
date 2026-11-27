// Clustering tab of the Multivariate workshop (ORIGIN_FEATURE_GAP_PLAN item 11,
// JMP_GAP_PLAN J13): the option model, the input checks that fail closed before
// a request is sent, and the dispatch to /api/stats/{kmeans,hierarchical}.
// Pure apart from the API call.
//
// Rows: the workshop's analysis view already left out excluded, masked and
// filtered rows (StatsInputReview above the tabs states how many). Rows with a
// blank or non-numeric cell in a chosen column are skipped here and COUNTED
// (`ClusterMeta.dropped`); nothing is imputed.

import {
  statsHierarchical, statsKmeans,
  type ClusterMethod, type ClusterMetric, type ClusterStandardize,
  type HierarchicalResult, type KmeansResult,
} from "../../../../lib/api/cluster";
import { listwiseCompleteWithIndices, multivarColumnValues } from "../../../../lib/multivar";
import type { DataStruct } from "../../../../lib/types";

export type ClusterTool = "kmeans" | "hierarchical";
export const CLUSTER_TOOLS: readonly { id: ClusterTool; label: string }[] = [
  { id: "kmeans", label: "k-means" },
  { id: "hierarchical", label: "Hierarchical" },
];

export interface ClusterOptions {
  kmeans: { k: number; standardize: ClusterStandardize; init: "kmeans++" | "random"; seed: number; maxIter: number; nInit: number };
  hierarchical: { method: ClusterMethod; metric: ClusterMetric; standardize: ClusterStandardize; cutBy: "k" | "distance"; k: number; distance: number };
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  kmeans: { k: 3, standardize: "zscore", init: "kmeans++", seed: 0, maxIter: 300, nInit: 10 },
  hierarchical: { method: "average", metric: "euclidean", standardize: "zscore", cutBy: "k", k: 3, distance: 1 },
};

export type ClusterResult =
  | { tool: "kmeans"; data: KmeansResult }
  | { tool: "hierarchical"; data: HierarchicalResult };

export interface ClusterMeta {
  /** 1-based worksheet rows that were clustered, in request order. */
  sourceRows: number[];
  dropped: number;
  columns: string[];
}

type Request =
  | { tool: "kmeans"; body: Parameters<typeof statsKmeans>[0] }
  | { tool: "hierarchical"; body: Parameters<typeof statsHierarchical>[0] };

export type PreparedCluster = { problem: string } | { problem: null; request: Request; meta: ClusterMeta };

const isInt = (v: number, lo: number, hi: number): boolean => Number.isInteger(v) && v >= lo && v <= hi;

/** The Ward / metric rule, stated once for the form (disabled option) and the check. */
export const WARD_REASON =
  "Ward linkage is defined only for Euclidean distances (it minimises a sum of squares); choose Euclidean, or single, complete or average linkage.";

export function prepareCluster(
  tool: ClusterTool, data: DataStruct, selected: readonly number[], rowIds: readonly number[] | null,
  labelOf: (col: number) => string, o: ClusterOptions,
): PreparedCluster {
  if (selected.length < 2) return { problem: "Select at least 2 numeric columns to cluster on." };
  const got = listwiseCompleteWithIndices(selected.map((c) => multivarColumnValues(data, c)));
  const n = got.rows.length;
  const dropped = data.time.length - n;
  const meta: ClusterMeta = {
    sourceRows: got.rowIndices.map((r) => (rowIds?.[r] ?? r) + 1), dropped, columns: selected.map(labelOf),
  };
  if (tool === "kmeans") {
    const k = o.kmeans;
    if (!isInt(k.k, 2, 100)) return { problem: "k must be a whole number from 2 to 100." };
    if (n < k.k) return { problem: `Only ${n} complete rows for k = ${k.k}; k-means needs at least k rows.` };
    if (!isInt(k.maxIter, 1, 100000)) return { problem: "Maximum iterations must be a whole number from 1 to 100000." };
    if (!isInt(k.nInit, 1, 200)) return { problem: "Restarts must be a whole number from 1 to 200." };
    if (!isInt(k.seed, 0, 2 ** 31 - 1)) return { problem: "Seed must be a whole number, 0 or more." };
    return { problem: null, meta, request: { tool, body: {
      x: got.rows, k: k.k, standardize: k.standardize, init: k.init, seed: k.seed, max_iter: k.maxIter, n_init: k.nInit,
    } } };
  }
  const h = o.hierarchical;
  if (n < 3) return { problem: `Only ${n} complete rows; hierarchical clustering needs at least 3.` };
  if (h.method === "ward" && h.metric !== "euclidean") return { problem: WARD_REASON };
  if (h.cutBy === "k" && !isInt(h.k, 1, n)) return { problem: `Number of clusters must be a whole number from 1 to ${n}.` };
  if (h.cutBy === "distance" && !(Number.isFinite(h.distance) && h.distance >= 0)) return { problem: "Cut distance must be 0 or more." };
  return { problem: null, meta, request: { tool, body: {
    x: got.rows, method: h.method, metric: h.metric, standardize: h.standardize,
    ...(h.cutBy === "k" ? { k: h.k } : { cut_distance: h.distance }),
  } } };
}

export async function runCluster(req: Request): Promise<ClusterResult> {
  if (req.tool === "kmeans") return { tool: "kmeans", data: await statsKmeans(req.body) };
  return { tool: "hierarchical", data: await statsHierarchical(req.body) };
}
