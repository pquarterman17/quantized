// Each Multivariate tab's Review inputs rows name only what that tab's run reads.

import { describe, expect, it } from "vitest";

import type { AnalysisInputs } from "../../../lib/analysisInputs";
import { DEFAULT_CLUSTER_OPTIONS } from "./cluster/clusterRun";
import { DEFAULT_EXT_OPTIONS } from "./ext/multivarExtRun";
import { clusterRows, extRows, multivarTabRows } from "./multivarReviewRows";

const inputs = { ok: true, dataset: { data: { labels: ["a", "b", "c"], units: ["", "", ""], time: [], values: [], metadata: {} } } } as unknown as AnalysisInputs;
const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

describe("multivarTabRows", () => {
  it("correlation shows the method, PCA the standardize switch, SPLOM only the columns", () => {
    const s = { selected: [0, 1], method: "spearman", standardize: false };
    expect(multivarTabRows("correlation", inputs, s)).toEqual([{ label: "Columns", value: "a, b" }, { label: "Correlation", value: "spearman" }]);
    expect(multivarTabRows("pca", inputs, s)).toEqual([{ label: "Columns", value: "a, b" }, { label: "PCA standardize", value: "off" }]);
    expect(labels(multivarTabRows("splom", inputs, s))).toEqual(["Columns"]);
  });
});

describe("extRows", () => {
  it("PLS: predictors exclude the responses; the response and component rule are stated", () => {
    const o = { ...DEFAULT_EXT_OPTIONS, pls: { ...DEFAULT_EXT_OPTIONS.pls, y: [2] } };
    const rows = extRows(inputs, [0, 1, 2], "pls", o);
    expect(rows.find((r) => r.label === "Predictors (X)")?.value).toBe("a, b");
    expect(rows.find((r) => r.label === "Response (Y)")?.value).toBe("c");
    expect(rows.find((r) => r.label === "Components")?.value).toMatch(/cross-validation \(up to 10\)/);
    expect(labels(rows)).not.toContain("Correlation");
  });

  it("LDA: variables exclude the class column, which reads not picked until chosen", () => {
    expect(extRows(inputs, [0, 1, 2], "lda", DEFAULT_EXT_OPTIONS).find((r) => r.label === "Class column")?.value).toBe("not picked");
    const o = { ...DEFAULT_EXT_OPTIONS, lda: { ...DEFAULT_EXT_OPTIONS.lda, classCol: 1, cvFolds: 0 } };
    const rows = extRows(inputs, [0, 1, 2], "lda", o);
    expect(rows.find((r) => r.label === "Variables")?.value).toBe("a, c");
    expect(rows.find((r) => r.label === "Class column")?.value).toBe("b");
    expect(rows.find((r) => r.label === "CV folds")?.value).toBe("none");
  });

  it("spectra PCA states its centre and scale switches", () => {
    expect(extRows(inputs, [0, 1], "spectra", DEFAULT_EXT_OPTIONS)).toEqual([
      { label: "Spectra", value: "a, b" }, { label: "Centre", value: "on" }, { label: "Scale", value: "off" },
    ]);
  });
});

describe("clusterRows", () => {
  it("k-means and hierarchical each list their own settings", () => {
    expect(labels(clusterRows(inputs, [0, 1], "kmeans", DEFAULT_CLUSTER_OPTIONS))).toEqual(["Columns", "Clusters (k)", "Standardize", "Start", "Restarts", "Seed"]);
    const h = clusterRows(inputs, [0, 1], "hierarchical", DEFAULT_CLUSTER_OPTIONS);
    expect(h.find((r) => r.label === "Cut into")?.value).toBe("3 clusters");
    const byDistance = { ...DEFAULT_CLUSTER_OPTIONS, hierarchical: { ...DEFAULT_CLUSTER_OPTIONS.hierarchical, cutBy: "distance" as const, distance: 2.5 } };
    expect(clusterRows(inputs, [0, 1], "hierarchical", byDistance).find((r) => r.label === "Cut at distance")?.value).toBe("2.5");
  });
});
