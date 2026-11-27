// Clustering tab: a result as the worksheets it commits (result-lifecycle
// contract, store/commitComputedOutput). The cluster-label worksheet is keyed
// by the SOURCE worksheet row of each clustered row, so a label is traceable to
// its row; it commits linked to the source (stale when the data changes). Pure.

import type { DataStruct } from "../../../../lib/types";
import type { ClusterMeta, ClusterResult } from "./clusterRun";

export interface ClusterOutput { key: string; button: string; name: string; data: DataStruct }

function struct(time: number[], cols: [string, number[]][], xName: string, meta: Record<string, unknown>): DataStruct {
  return {
    time, values: time.map((_, i) => cols.map(([, c]) => c[i])), labels: cols.map(([n]) => n), units: cols.map(() => ""),
    metadata: { x_column_name: xName, technique: "multivariate", ...meta },
  };
}

const nan = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);

export function clusterOutputs(r: ClusterResult, meta: ClusterMeta): ClusterOutput[] {
  const common = { columns: meta.columns, dropped: meta.dropped };
  if (r.tool === "kmeans") {
    const d = r.data;
    const info = { kmeans: { ...common, k: d.k, standardize: d.standardize, init: d.init, seed: d.seed, nInit: d.n_init,
      maxIter: d.max_iter, totalWcss: d.total_wcss, silhouette: d.silhouette, converged: d.converged } };
    const labelCols: [string, number[]][] = [["cluster", d.labels]];
    if (d.silhouette_points) labelCols.push(["silhouette", d.silhouette_points]);
    const ks = d.centroids.map((_, i) => i + 1);
    const cols: [string, number[]][] = meta.columns.map((c, j) => [c, d.centroids.map((row) => row[j])]);
    cols.push(["count", d.counts], ["WCSS", d.wcss_by_cluster]);
    if (d.silhouette_by_cluster) cols.push(["silhouette", d.silhouette_by_cluster]);
    return [
      { key: "labels", button: "cluster labels", name: `k-means cluster labels (k = ${d.k})`,
        data: struct(meta.sourceRows, labelCols, "worksheet row", info) },
      { key: "centroids", button: "centroids", name: `k-means centroids (k = ${d.k})`,
        data: struct(ks, cols, "cluster", info) },
    ];
  }
  const d = r.data;
  const info = { hierarchical: { ...common, method: d.method, metric: d.metric, standardize: d.standardize, cutBy: d.cut_by,
    k: d.k, cutDistance: d.cut_distance, cophenetic: d.cophenetic_correlation } };
  const merges = d.linkage.map((_, i) => i + 1);
  return [
    { key: "labels", button: "cluster labels", name: `Hierarchical cluster labels (${d.k} clusters)`,
      data: struct(meta.sourceRows, [["cluster", d.labels]], "worksheet row", info) },
    { key: "linkage", button: "linkage table", name: `Hierarchical linkage (${d.method}, ${d.metric})`,
      data: struct(merges, [["cluster A", d.linkage.map((l) => l[0])], ["cluster B", d.linkage.map((l) => l[1])],
        ["height", d.linkage.map((l) => nan(l[2]))], ["size", d.linkage.map((l) => l[3])]], "merge", info) },
  ];
}
