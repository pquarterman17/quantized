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
  statsClusterVariables, statsHierarchical, statsKmeans,
  type ClusterMethod, type ClusterMetric, type ClusterStandardize, type VariableDistance,
} from "../../../../lib/api/cluster";
import type { ClusterRun } from "../../../../lib/clusterAnalysisResult";
import { listwiseCompleteWithIndices, multivarColumnValues } from "../../../../lib/multivar";
import type { DataStruct } from "../../../../lib/types";
import { parseCentreTable, pickRowCentres, type Centres, type ClusterStart } from "./clusterCentres";

export type ClusterTool = "kmeans" | "hierarchical" | "variables";
export const CLUSTER_TOOLS: readonly { id: ClusterTool; label: string }[] = [
  { id: "kmeans", label: "k-means" },
  { id: "hierarchical", label: "Hierarchical" },
  { id: "variables", label: "Variables" },
];

export interface ClusterOptions {
  kmeans: {
    k: number; standardize: ClusterStandardize; init: "kmeans++" | "random"; seed: number; maxIter: number; nInit: number;
    /** "auto": seeded start (init); "rows": the rows in `startRows`; "table": the centres in `centreText`. */
    start: ClusterStart; startRows: string; centreText: string;
  };
  hierarchical: { method: ClusterMethod; metric: ClusterMetric; standardize: ClusterStandardize; cutBy: "k" | "distance"; k: number; distance: number };
  /** Cluster the COLUMNS: linkage on 1 - |r| ("abs") or 1 - r ("signed"). */
  variables: { method: "single" | "complete" | "average"; corr: VariableDistance; cutBy: "k" | "distance"; k: number; distance: number };
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  kmeans: { k: 3, standardize: "zscore", init: "kmeans++", seed: 0, maxIter: 300, nInit: 10, start: "auto", startRows: "", centreText: "" },
  hierarchical: { method: "average", metric: "euclidean", standardize: "zscore", cutBy: "k", k: 3, distance: 1 },
  variables: { method: "average", corr: "abs", cutBy: "k", k: 2, distance: 0.5 },
};

export type ClusterResult = ClusterRun;

export interface ClusterMeta {
  /** 1-based worksheet rows that were clustered, in request order. */
  sourceRows: number[];
  dropped: number;
  columns: string[];
  /** k-means with given starting centres: them, in the data's units; else null. */
  startCentres: number[][] | null;
}

type Request =
  | { tool: "kmeans"; body: Parameters<typeof statsKmeans>[0] }
  | { tool: "hierarchical"; body: Parameters<typeof statsHierarchical>[0] }
  | { tool: "variables"; body: Parameters<typeof statsClusterVariables>[0] };

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
    sourceRows: got.rowIndices.map((r) => (rowIds?.[r] ?? r) + 1), dropped, columns: selected.map(labelOf), startCentres: null,
  };
  if (tool === "kmeans") {
    const k = o.kmeans;
    if (!isInt(k.k, 2, 100)) return { problem: "k must be a whole number from 2 to 100." };
    if (n < k.k) return { problem: `Only ${n} complete rows for k = ${k.k}; k-means needs at least k rows.` };
    if (!isInt(k.maxIter, 1, 100000)) return { problem: "Maximum iterations must be a whole number from 1 to 100000." };
    if (!isInt(k.nInit, 1, 200)) return { problem: "Restarts must be a whole number from 1 to 200." };
    if (!isInt(k.seed, 0, 2 ** 31 - 1)) return { problem: "Seed must be a whole number, 0 or more." };
    const given: Centres | null = k.start === "rows" ? pickRowCentres(k.startRows, k.k, meta.sourceRows, got.rows)
      : k.start === "table" ? parseCentreTable(k.centreText, k.k, selected.length) : null;
    if (given && given.problem !== null) return { problem: given.problem };
    const centres = given ? given.centres : null;
    return { problem: null, meta: { ...meta, startCentres: centres }, request: { tool, body: {
      x: got.rows, k: k.k, standardize: k.standardize, init: k.init, seed: k.seed, max_iter: k.maxIter, n_init: k.nInit,
      ...(centres ? { initial_centers: centres } : {}),
    } } };
  }
  if (tool === "variables") {
    const v = o.variables;
    if (selected.length < 3) return { problem: "Variable clustering needs at least 3 numeric columns." };
    if (n < 3) return { problem: `Only ${n} complete rows; variable clustering needs at least 3.` };
    if (v.cutBy === "k" && !isInt(v.k, 1, selected.length)) return { problem: `Number of clusters must be a whole number from 1 to ${selected.length}.` };
    if (v.cutBy === "distance" && !(Number.isFinite(v.distance) && v.distance >= 0)) return { problem: "Cut distance must be 0 or more." };
    return { problem: null, meta, request: { tool, body: {
      x: got.rows, method: v.method, distance: v.corr, ...(v.cutBy === "k" ? { k: v.k } : { cut_distance: v.distance }),
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
  if (req.tool === "variables") return { tool: "variables", data: await statsClusterVariables(req.body) };
  return { tool: "hierarchical", data: await statsHierarchical(req.body) };
}
