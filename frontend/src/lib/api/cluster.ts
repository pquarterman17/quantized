// /api/stats/{kmeans,hierarchical} and /api/export/dendrogram-figure wrappers
// (ORIGIN_FEATURE_GAP_PLAN item 11, JMP_GAP_PLAN J13). NOT re-exported by
// lib/api.ts: the only consumer is the lazy Clustering tab of the Multivariate
// workshop, which imports this path directly (eager bundle unchanged).

import { postDownload, postJSON } from "./http";

export type ClusterStandardize = "none" | "zscore" | "range";
export type ClusterMethod = "single" | "complete" | "average" | "ward";
export type ClusterMetric = "euclidean" | "cityblock" | "correlation";

export interface KmeansBody {
  x: number[][]; k: number; standardize?: ClusterStandardize; init?: "kmeans++" | "random";
  seed?: number; max_iter?: number; n_init?: number;
}
export interface KmeansResult {
  k: number; n: number; p: number; standardize: ClusterStandardize; init: string; seed: number;
  max_iter: number; n_init: number; iterations: number; converged: boolean; best_restart: number;
  /** 1-based cluster number per input row. */
  labels: number[];
  /** k x p, original units */
  centroids: number[][]; centroids_scaled: number[][];
  counts: number[]; wcss_by_cluster: number[]; total_wcss: number; between_ss: number; total_ss: number;
  wcss_original: number;
  silhouette: number | null; silhouette_by_cluster: number[] | null; silhouette_points: number[] | null;
  silhouette_note: string | null;
}

export interface HierarchicalBody {
  x: number[][]; method?: ClusterMethod; metric?: ClusterMetric; standardize?: ClusterStandardize;
  k?: number; cut_distance?: number;
}
export interface DendrogramSegment { x: number[]; y: number[]; cluster: number }
export interface DendrogramGeometry {
  n_leaves: number; leaf_order: number[]; leaf_cluster: number[]; segments: DendrogramSegment[];
  cut: number; max_height: number;
}
export interface HierarchicalResult {
  n: number; p: number; method: ClusterMethod; metric: ClusterMetric; standardize: ClusterStandardize;
  cut_by: "k" | "distance"; k: number; cut_distance: number;
  labels: number[]; counts: number[];
  /** n-1 rows: [child a, child b, height, size] (SciPy linkage matrix). */
  linkage: number[][];
  cophenetic_correlation: number | null;
  dendrogram: DendrogramGeometry;
}

export interface DendrogramFigureBody {
  geometry: DendrogramGeometry; leaf_names?: string[]; title?: string; fmt?: string; style?: string;
  dpi?: number; width_in?: number; height_in?: number; filename?: string;
}

export const statsKmeans = (body: KmeansBody): Promise<KmeansResult> => postJSON("/api/stats/kmeans", body);
export const statsHierarchical = (body: HierarchicalBody): Promise<HierarchicalResult> =>
  postJSON("/api/stats/hierarchical", body);
export const exportDendrogramFigure = (body: DendrogramFigureBody, signal?: AbortSignal): Promise<void> =>
  postDownload("/api/export/dendrogram-figure", body, `dendrogram.${body.fmt ?? "pdf"}`, signal);
