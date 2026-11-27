import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KmeansResult } from "../../../../lib/api/cluster";
import type { DataStruct } from "../../../../lib/types";
import { clusterOutputs } from "./clusterOutputs";
import {
  DEFAULT_CLUSTER_OPTIONS, WARD_REASON, prepareCluster, runCluster, type ClusterOptions,
} from "./clusterRun";

const api = vi.hoisted(() => ({ statsKmeans: vi.fn(), statsHierarchical: vi.fn() }));
vi.mock("../../../../lib/api/cluster", () => api);

beforeEach(() => vi.clearAllMocks());

// 8 rows; columns 0 = a, 1 = b. Row 5 has a blank in b.
const rows = [[1, 2], [2, 1], [3, 5], [4, 3], [5, 7], [6, Number.NaN], [7, 4], [8, 9]];
const data: DataStruct = { time: rows.map((_, i) => 100 + i), values: rows, labels: ["a", "b"], units: ["", ""], metadata: {} };
const label = (c: number) => ["a", "b"][c] ?? "x";
const km = (p: Partial<ClusterOptions["kmeans"]>): ClusterOptions => ({ ...DEFAULT_CLUSTER_OPTIONS, kmeans: { ...DEFAULT_CLUSTER_OPTIONS.kmeans, ...p } });
const hc = (p: Partial<ClusterOptions["hierarchical"]>): ClusterOptions => ({ ...DEFAULT_CLUSTER_OPTIONS, hierarchical: { ...DEFAULT_CLUSTER_OPTIONS.hierarchical, ...p } });

describe("prepareCluster k-means", () => {
  it("needs two columns", () => {
    expect(prepareCluster("kmeans", data, [0], null, label, km({}))).toMatchObject({ problem: expect.stringMatching(/at least 2/) });
  });

  it("sends only complete rows, counts the skipped one and keeps the worksheet row numbers", () => {
    const rowIds = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * 10);
    const p = prepareCluster("kmeans", data, [0, 1], rowIds, label, km({ k: 2, seed: 5, nInit: 4 }));
    if (p.problem !== null) throw new Error(p.problem);
    const body = p.request.body as { x: number[][]; k: number; seed: number; n_init: number; standardize: string; init: string };
    expect(body.x).toHaveLength(7);
    expect(body).toMatchObject({ k: 2, seed: 5, n_init: 4, standardize: "zscore", init: "kmeans++" });
    expect(p.meta.dropped).toBe(1);
    expect(p.meta.sourceRows).toEqual([1, 11, 21, 31, 41, 61, 71]);
    expect(p.meta.columns).toEqual(["a", "b"]);
  });

  it("refuses bad options and k above the row count, each with a reason", () => {
    const bad = (patch: Partial<ClusterOptions["kmeans"]>, re: RegExp) =>
      expect(prepareCluster("kmeans", data, [0, 1], null, label, km(patch))).toMatchObject({ problem: expect.stringMatching(re) });
    bad({ k: 1 }, /k must be/);
    bad({ k: 8 }, /Only 7 complete rows/);
    bad({ nInit: 0 }, /Restarts/);
    bad({ maxIter: 0 }, /iterations/);
    bad({ seed: -1 }, /Seed/);
    bad({ seed: 1.5 }, /Seed/);
  });
});

describe("prepareCluster hierarchical", () => {
  it("cuts by k or by distance, never both", () => {
    const k = prepareCluster("hierarchical", data, [0, 1], null, label, hc({ cutBy: "k", k: 2 }));
    const d = prepareCluster("hierarchical", data, [0, 1], null, label, hc({ cutBy: "distance", distance: 1.5 }));
    if (k.problem !== null || d.problem !== null) throw new Error("unexpected refusal");
    expect(k.request.body).toMatchObject({ k: 2, method: "average", metric: "euclidean" });
    expect("cut_distance" in k.request.body).toBe(false);
    expect(d.request.body).toMatchObject({ cut_distance: 1.5 });
    expect("k" in d.request.body).toBe(false);
  });

  it("refuses Ward with a non-Euclidean distance and says why", () => {
    const p = prepareCluster("hierarchical", data, [0, 1], null, label, hc({ method: "ward", metric: "cityblock" }));
    expect(p).toEqual({ problem: WARD_REASON });
    expect(WARD_REASON).toMatch(/only for Euclidean/);
  });

  it("validates the cut", () => {
    expect(prepareCluster("hierarchical", data, [0, 1], null, label, hc({ k: 9 }))).toMatchObject({ problem: expect.stringMatching(/1 to 7/) });
    expect(prepareCluster("hierarchical", data, [0, 1], null, label, hc({ cutBy: "distance", distance: -1 }))).toMatchObject({ problem: expect.stringMatching(/Cut distance/) });
  });
});

describe("runCluster and outputs", () => {
  const KM: KmeansResult = {
    k: 2, n: 4, p: 2, standardize: "zscore", init: "kmeans++", seed: 3, max_iter: 300, n_init: 10, iterations: 2, converged: true,
    best_restart: 1, labels: [1, 1, 2, 2], centroids: [[1, 1], [9, 9]], centroids_scaled: [[-1, -1], [1, 1]], counts: [2, 2],
    wcss_by_cluster: [0.5, 0.4], total_wcss: 0.9, between_ss: 5, total_ss: 5.9, wcss_original: 0.9,
    silhouette: 0.8, silhouette_by_cluster: [0.8, 0.8], silhouette_points: [0.8, 0.8, 0.8, 0.8], silhouette_note: null,
  };

  it("dispatches to the right route", async () => {
    api.statsKmeans.mockResolvedValue(KM);
    const p = prepareCluster("kmeans", data, [0, 1], null, label, km({ k: 2 }));
    if (p.problem !== null) throw new Error(p.problem);
    expect(await runCluster(p.request)).toEqual({ tool: "kmeans", data: KM });
    expect(api.statsKmeans).toHaveBeenCalledOnce();
    expect(api.statsHierarchical).not.toHaveBeenCalled();
  });

  it("the label worksheet is keyed by source row; the centroid table is in original units", () => {
    const outs = clusterOutputs({ tool: "kmeans", data: KM }, { sourceRows: [3, 4, 9, 10], dropped: 0, columns: ["a", "b"] });
    const labels = outs.find((o) => o.key === "labels")!.data;
    expect(labels.time).toEqual([3, 4, 9, 10]);
    expect(labels.labels).toEqual(["cluster", "silhouette"]);
    expect(labels.values.map((r) => r[0])).toEqual([1, 1, 2, 2]);
    const cent = outs.find((o) => o.key === "centroids")!.data;
    expect(cent.labels).toEqual(["a", "b", "count", "WCSS", "silhouette"]);
    expect(cent.values[1].slice(0, 2)).toEqual([9, 9]);
    expect(cent.metadata).toMatchObject({ kmeans: { seed: 3, k: 2 } });
  });

  it("hierarchical outputs: labels by source row and the linkage table", () => {
    const outs = clusterOutputs({
      tool: "hierarchical",
      data: { n: 3, p: 2, method: "average", metric: "euclidean", standardize: "none", cut_by: "k", k: 2, cut_distance: 2,
        labels: [1, 1, 2], counts: [2, 1], linkage: [[0, 1, 1, 2], [2, 3, 5, 3]], cophenetic_correlation: 0.9,
        dendrogram: { n_leaves: 3, leaf_order: [0, 1, 2], leaf_cluster: [1, 1, 2], segments: [], cut: 2, max_height: 5 } },
    }, { sourceRows: [1, 2, 3], dropped: 0, columns: ["a", "b"] });
    expect(outs.map((o) => o.key)).toEqual(["labels", "linkage"]);
    expect(outs[0].data.time).toEqual([1, 2, 3]);
    expect(outs[1].data.labels).toEqual(["cluster A", "cluster B", "height", "size"]);
    expect(outs[1].data.values[1]).toEqual([2, 3, 5, 3]);
  });
});
