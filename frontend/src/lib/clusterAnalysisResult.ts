// Clustering (ORIGIN_FEATURE_GAP_PLAN item 11) as a saved snapshot result: one
// result per Run of one Clustering tool (k-means, hierarchical, variables) on
// the source's analysis view. What was run (method, distance, scaling, seed, k
// or cutoff, starting centres) is recorded in the envelope and in the recipe
// the tool reopens from; the tables hold the cluster sizes, centroids and
// within-cluster sums of squares, the linkage and the labels (keyed by the
// SOURCE worksheet row). "Add as worksheet" stays a separate committed output.
// Pure; imported by the lazy Clustering tab only (the describer is the one
// piece the saved book reads, see toolResultDescribe.ts).

import type { HierarchicalResult, KmeansResult, VariablesResult } from "./api/cluster";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { fmtNum } from "./format";
import { INPUTS_PARAM, recordedInputs } from "./resultInputsRecord";
import { CLUSTER_RESULT, type ClusterRecipe } from "./toolResultKinds";
import type { Dataset } from "./types";
import { boundedTables } from "./variabilityAnalysisResult";

export type ClusterRun =
  | { tool: "kmeans"; data: KmeansResult }
  | { tool: "hierarchical"; data: HierarchicalResult }
  | { tool: "variables"; data: VariablesResult };

export interface ClusterSnapshot {
  run: ClusterRun;
  /** 1-based worksheet rows that were clustered, in request order. */
  sourceRows: readonly number[];
  /** Rows skipped for a blank or non-numeric cell (counted, never imputed). */
  dropped: number;
  /** The picked columns' labels, in the order clustered. */
  columns: readonly string[];
  /** k-means with given centres: them, in the data's units; else null. */
  startCentres: readonly (readonly number[])[] | null;
}

/** Bumped when a tool's method changes (provisional, owner to confirm). */
export const CLUSTER_ALGORITHM_VERSION = 1;

export const CLUSTER_TOOL_LABEL: Readonly<Record<ClusterRecipe["tool"], string>> = {
  kmeans: "k-means", hierarchical: "Hierarchical", variables: "Variable clustering",
};
export const CLUSTER_TABLES = {
  clusters: "Clusters", startCentres: "Starting centres", labels: "Cluster labels", linkage: "Linkage",
  variables: "Variable clusters", correlation: "Correlation",
} as const;

const nul = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const SCALING: Readonly<Record<string, string>> = { zscore: "z-score", range: "range (0 to 1)", none: "none" };
const DISTANCE: Readonly<Record<string, string>> = {
  euclidean: "Euclidean", sqeuclidean: "squared Euclidean", cityblock: "city block", cosine: "cosine", correlation: "correlation (1 - r)",
  abs: "1 - |r|", signed: "1 - r",
};

function clusterTable(cols: readonly string[], counts: number[], wcss: number[], centroids: number[][], sil?: number[] | null): AnalysisResultTable {
  return {
    title: CLUSTER_TABLES.clusters,
    columns: ["cluster", "n", "within SS", ...(sil ? ["silhouette"] : []), ...cols],
    rows: counts.map((n, i) => [i + 1, n, nul(wcss[i]), ...(sil ? [nul(sil[i])] : []), ...centroids[i].map(nul)]),
  };
}

const linkageTable = (linkage: number[][]): AnalysisResultTable => ({
  title: CLUSTER_TABLES.linkage, columns: ["merge", "cluster A", "cluster B", "height", "size"],
  rows: linkage.map((l, i) => [i + 1, l[0], l[1], nul(l[2]), l[3]]),
});

/** The tables a clustering result saves, in saved order. */
export function clusterResultTables(s: ClusterSnapshot): AnalysisResultTable[] {
  const { run } = s;
  const labels = (name: string, rows: readonly number[], values: number[]): AnalysisResultTable =>
    ({ title: name, columns: ["source row", "cluster"], rows: rows.map((r, i) => [r, values[i]]) });
  if (run.tool === "kmeans") {
    const d = run.data;
    return [
      clusterTable(s.columns, d.counts, d.wcss_by_cluster, d.centroids, d.silhouette_by_cluster),
      ...(s.startCentres ? [{ title: CLUSTER_TABLES.startCentres, columns: ["start", ...s.columns],
        rows: s.startCentres.map((c, i) => [i + 1, ...c.map(nul)]) }] : []),
      labels(CLUSTER_TABLES.labels, s.sourceRows, d.labels),
    ];
  }
  if (run.tool === "hierarchical") {
    const d = run.data;
    return [clusterTable(s.columns, d.counts, d.wcss_by_cluster, d.centroids), linkageTable(d.linkage),
      labels(CLUSTER_TABLES.labels, s.sourceRows, d.labels)];
  }
  const d = run.data;
  return [
    { title: CLUSTER_TABLES.variables, columns: ["variable", "cluster"], rows: s.columns.map((c, i) => [c, d.labels[i]]) },
    linkageTable(d.linkage),
    { title: CLUSTER_TABLES.correlation, columns: ["variable", ...s.columns],
      rows: s.columns.map((c, i) => [c, ...d.correlation[i].map(nul)]) },
  ];
}

/** What was run, as shown labels and values (the envelope's scalars and the saved book's settings). */
export function clusterSettingsText(recipe: ClusterRecipe, run: ClusterRun, startCentres: boolean): [string, string | number][] {
  const o = recipe.options;
  const cut = (d: { cut_by: string; k: number; cut_distance: number }): [string, string | number][] =>
    d.cut_by === "k" ? [["Clusters", d.k]] : [["Cut distance", Number(d.cut_distance.toPrecision(6))], ["Clusters", d.k]];
  if (run.tool === "kmeans") {
    const d = run.data;
    return [["Method", "k-means"], ["Clusters", d.k], ["Scaling", SCALING[d.standardize] ?? d.standardize],
      ["Start", startCentres ? `given centres (${o["start"] === "rows" ? "rows " + String(o["startRows"]) : "table"})` : d.init === "random" ? "random rows" : "k-means++"],
      ["Seed", startCentres ? "not used (given centres)" : d.seed], ["Restarts", d.n_init], ["Maximum iterations", d.max_iter]];
  }
  if (run.tool === "hierarchical") {
    const d = run.data;
    return [["Method", "Hierarchical"], ["Linkage", d.method], ["Distance", DISTANCE[d.metric] ?? d.metric],
      ["Scaling", SCALING[d.standardize] ?? d.standardize], ...cut(d)];
  }
  const d = run.data;
  return [["Method", "Variable clustering"], ["Linkage", d.method], ["Distance", DISTANCE[d.distance] ?? d.distance],
    ["Scaling", "none (a correlation is scale-free)"], ...cut(d)];
}

function interpretation(run: ClusterRun): string {
  const d = run.data;
  const sizes = `sizes ${d.counts.join(", ")}`;
  if (run.tool === "kmeans") {
    return `${run.data.k} clusters (${sizes}); total within SS ${fmtNum(run.data.total_wcss)}${run.data.converged ? "" : "; NOT converged"}.`;
  }
  if (run.tool === "hierarchical") return `${run.data.k} clusters (${sizes}); cophenetic correlation ${fmtNum(run.data.cophenetic_correlation ?? Number.NaN)}.`;
  return `${run.data.k} groups of variables (${sizes}).`;
}

export function clusterAnalysisResult(
  id: string, source: Dataset, recipe: ClusterRecipe, snapshot: ClusterSnapshot, createdAt = new Date().toISOString(),
): AnalysisResult {
  const { run } = snapshot;
  const bounded = boundedTables(clusterResultTables(snapshot));
  const given = snapshot.startCentres !== null;
  const warnings = [
    ...(snapshot.dropped ? [`${snapshot.dropped} row${snapshot.dropped === 1 ? "" : "s"} with a blank or non-numeric cell skipped (not imputed).`] : []),
    ...(run.tool === "kmeans" && !run.data.converged ? ["k-means did not converge within the iteration limit."] : []),
    ...bounded.warnings,
  ];
  const settings = Object.fromEntries(clusterSettingsText(recipe, run, given));
  return {
    version: ANALYSIS_RESULT_VERSION, id,
    name: `${CLUSTER_TOOL_LABEL[recipe.tool]} (${snapshot.columns.length} columns) · ${source.name}`,
    producer: { id: CLUSTER_RESULT, label: "Clustering", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: {
      datasetId: source.id,
      channels: recipe.columns.filter((c) => c >= 0).map((c) => ({ index: c, label: source.data.labels[c] ?? `column ${c + 1}`, unit: source.data.units[c] ?? "" })),
    },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: CLUSTER_TOOL_LABEL[recipe.tool], Interpretation: interpretation(run), Columns: snapshot.columns.join(", "),
      ...settings, N: snapshot.sourceRows.length, "Rows skipped": snapshot.dropped,
      ...(run.tool === "kmeans" ? { "Total within SS": nul(run.data.total_wcss) } : {}),
    },
    parameters: {
      recipe: { tool: recipe.tool, columns: [...recipe.columns], options: recipe.options },
      algorithm: { id: `cluster-${recipe.tool}`, version: CLUSTER_ALGORITHM_VERSION },
      [INPUTS_PARAM]: recordedInputs([source], { xKey: null }),
    },
    tables: bounded.tables, warnings, createdAt,
  };
}
