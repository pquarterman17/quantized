// The clustering result envelope: the tables hold what the backend returned (no
// recomputation), the settings are recorded, the recipe parses back and
// survives a save/open round trip, and a bad recipe fails closed.

import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults, type AnalysisResult } from "./analysisResult";
import { clusterAnalysisResult, clusterResultTables, type ClusterRun, type ClusterSnapshot } from "./clusterAnalysisResult";
import { snapshotResultKey } from "./snapshotResultKey";
import { TOOL_RESULT_DESCRIBERS } from "./toolResultDescribe";
import { CLUSTER_RESULT, clusterQuestion, clusterRecipe } from "./toolResultKinds";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "s", name: "s.dat",
  data: { time: [1, 2, 3, 4], values: [[1, 5], [2, 4], [8, 1], [9, 0]], labels: ["a", "b"], units: ["", ""], metadata: {} },
};
const GEOM = { n_leaves: 4, leaf_order: [0, 1, 2, 3], leaf_cluster: [1, 1, 2, 2], segments: [], cut: 2, max_height: 4 };
const HIER: ClusterRun = {
  tool: "hierarchical",
  data: {
    n: 4, p: 2, method: "ward", metric: "euclidean", standardize: "none", cut_by: "distance", k: 2, cut_distance: 2.5,
    labels: [1, 1, 2, 2], counts: [2, 2], linkage: [[0, 1, 1.41, 2], [2, 3, 1.41, 2], [4, 5, 8.6, 4]],
    cophenetic_correlation: 0.9, centroids: [[1.5, 4.5], [8.5, 0.5]], wcss_by_cluster: [0.5, 0.5], total_wcss: 1, dendrogram: GEOM,
  },
};
const snap = (run: ClusterRun): ClusterSnapshot => ({ run, sourceRows: [1, 2, 3, 4], dropped: 0, columns: ["a", "b"], startCentres: null });
const recipe = { tool: "hierarchical" as const, columns: [0, 1], options: { method: "ward", metric: "euclidean", cutBy: "distance", distance: 2.5 } };

describe("clusterResultTables", () => {
  it("hierarchical: sizes, centroids and within SS as the backend returned them; labels by source row", () => {
    const [clusters, linkage, labels] = clusterResultTables(snap(HIER));
    expect(clusters).toEqual({ title: "Clusters", columns: ["cluster", "n", "within SS", "a", "b"], rows: [[1, 2, 0.5, 1.5, 4.5], [2, 2, 0.5, 8.5, 0.5]] });
    expect(linkage.rows[2]).toEqual([3, 4, 5, 8.6, 4]);
    expect(labels.rows).toEqual([[1, 1], [2, 1], [3, 2], [4, 2]]);
  });
  it("the centroids are the cluster means of the data (an independent computation)", () => {
    const rows = source.data.values;
    const mean = (ids: number[], j: number) => ids.reduce((s, i) => s + rows[i][j], 0) / ids.length;
    expect([mean([0, 1], 0), mean([0, 1], 1)]).toEqual([1.5, 4.5]);
    expect([mean([2, 3], 0), mean([2, 3], 1)]).toEqual([8.5, 0.5]);
  });
  it("variables: a table of variable and cluster, and the correlation matrix", () => {
    const run: ClusterRun = { tool: "variables", data: { n: 4, p: 2, method: "average", distance: "abs", cut_by: "k", k: 1, cut_distance: 1, labels: [1, 1],
      counts: [2], linkage: [[0, 1, 0.1, 2]], cophenetic_correlation: null, dendrogram: GEOM, correlation: [[1, -0.9], [-0.9, 1]] } };
    const t = clusterResultTables(snap(run));
    expect(t.map((x) => x.title)).toEqual(["Variable clusters", "Linkage", "Correlation"]);
    expect(t[0].rows).toEqual([["a", 1], ["b", 1]]);
    expect(t[2].rows).toEqual([["a", 1, -0.9], ["b", -0.9, 1]]);
  });
});

describe("clusterAnalysisResult", () => {
  const built = clusterAnalysisResult("r1", source, recipe, snap(HIER), "2026-11-28T00:00:00Z");
  it("records what was run", () => {
    expect(built.scalarValues).toMatchObject({ Method: "Hierarchical", Linkage: "ward", Distance: "Euclidean", Scaling: "none", "Cut distance": 2.5, Clusters: 2, N: 4 });
    expect(built.parameters).toMatchObject({ recipe, algorithm: { id: "cluster-hierarchical", version: 1 } });
  });
  it("round-trips through a saved file and keeps its recipe, its key question and a describer", () => {
    const [back] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([built])));
    expect(back.producer.id).toBe(CLUSTER_RESULT);
    expect(clusterRecipe(back, source)).toEqual(recipe);
    expect(clusterQuestion(clusterRecipe(back)!)).toEqual(clusterQuestion(recipe));
    expect(back.tables).toEqual(built.tables);
    const described = TOOL_RESULT_DESCRIBERS[CLUSTER_RESULT](back)!;
    expect(described.method).toBe("Clustering: Hierarchical");
    expect(described.settings).toContainEqual({ label: "Linkage", value: "ward" });
    expect(described.inputKeys).toEqual({ xKey: null, yKeys: [0, 1], noX: true });
  });
  it("the duplicate key is by value: other options are another question", () => {
    const a = snapshotResultKey(CLUSTER_RESULT, "s", "f", clusterQuestion(recipe));
    expect(a).toBe(snapshotResultKey(CLUSTER_RESULT, "s", "f", clusterQuestion({ ...recipe, options: { ...recipe.options } })));
    expect(a).not.toBe(snapshotResultKey(CLUSTER_RESULT, "s", "f", clusterQuestion({ ...recipe, options: { ...recipe.options, method: "average" } })));
  });
  it("fails closed on a bad recipe", () => {
    const bad = (r: unknown): AnalysisResult => ({ ...built, parameters: { recipe: r as never } });
    expect(clusterRecipe(bad({ ...recipe, tool: "dbscan" }))).toBeNull();
    expect(clusterRecipe(bad({ ...recipe, columns: [0] }))).toBeNull();
    expect(clusterRecipe(bad({ ...recipe, columns: [0, 0] }))).toBeNull();
    expect(clusterRecipe(bad({ ...recipe, options: { x: [1] } }))).toBeNull();
    expect(clusterRecipe(bad(recipe), { ...source, data: { ...source.data, labels: ["a"] } })).toBeNull();
    expect(TOOL_RESULT_DESCRIBERS[CLUSTER_RESULT](bad({ tool: "x" }))).toBeNull();
  });
});
