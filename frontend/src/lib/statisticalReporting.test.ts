import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { statisticalReporting } from "./statisticalReporting";

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    version: 1, id: "r", name: "ANOVA", producer: { id: "fit-y-by-x", label: "Fit Y by X", version: 1 },
    sources: [{ datasetId: "d", role: "input" }], outputs: [], warnings: [], createdAt: "2026-10-12T00:00:00Z",
    ...overrides,
  };
}

describe("statisticalReporting", () => {
  it("indexes saved effect sizes, intervals, adjustments, assumptions, and missing-data disclosures", () => {
    const summary = statisticalReporting(result({
      scalarValues: { Interpretation: "Groups differ.", "Rows omitted by listwise deletion": 2, Balanced: "no" },
      tables: [
        { title: "Contingency tests", columns: ["level", "Cramér's V"], rows: [["all", 0.42]] },
        { title: "Tukey HSD", columns: ["A", "B", "CI low", "CI high"], rows: [["a", "b", 1, 3]] },
      ],
      warnings: ["Levene: unequal variances."],
    }));
    expect(summary.interpretation).toBe("Groups differ.");
    expect(summary.effectSizes.join(" ")).toMatch(/Cramér's V = 0.42/);
    expect(summary.intervals).toEqual([expect.stringMatching(/2 saved rows|1 saved row/)]);
    expect(summary.adjustments).toEqual([expect.stringMatching(/Tukey HSD/)]);
    expect(summary.assumptions.join(" ")).toMatch(/Balanced|Levene/);
    expect(summary.missingData).toContain("Rows omitted by listwise deletion: 2");
  });

  it("states when evidence was not recorded instead of implying a pass", () => {
    const summary = statisticalReporting(result());
    expect(summary.effectSizes[0]).toMatch(/No effect size/);
    expect(summary.intervals[0]).toMatch(/No confidence/);
    expect(summary.assumptions[0]).toMatch(/No assumption/);
    expect(summary.adjustments[0]).toMatch(/No multiple-comparison/);
    expect(summary.missingData[0]).toMatch(/not recorded/);
  });

  it("does not mislabel variance-component estimates as assumption checks", () => {
    const summary = statisticalReporting(result({
      tables: [{ title: "Variance components", columns: ["component", "variance"], rows: [["A", 2.5]] }],
    }));
    expect(summary.assumptions).toEqual([expect.stringMatching(/No assumption check/)]);
  });

  it("recognizes R² without confusing regression labels with other evidence", () => {
    const summary = statisticalReporting(result({
      scalarValues: { "adjusted R²": 0.91 },
      tables: [
        { title: "Multiple regression", columns: ["term", "beta"], rows: [["dose", 1.2]] },
      ],
      warnings: ['Table "Pairwise results" was too large to save and was omitted.'],
    }));
    expect(summary.effectSizes).toEqual(["adjusted R²: 0.91"]);
    expect(summary.adjustments).toEqual([expect.stringMatching(/No multiple-comparison adjustment/)]);
    expect(summary.missingData).toEqual([expect.stringMatching(/not recorded/)]);
  });
});
