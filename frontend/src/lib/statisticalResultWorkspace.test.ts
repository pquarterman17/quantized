import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { statisticalTablePreviews, statisticalWorkspaceResults } from "./statisticalResultWorkspace";
import type { Dataset } from "./types";

const source = (id: string, name: string): Dataset => ({
  id, name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: ["V"], metadata: {} },
});

const result = (id: string, producer: string, dataset: Dataset, createdAt: string): AnalysisResult => ({
  version: 1, id, name: `${producer} result`,
  producer: { id: producer, label: producer, version: 1 },
  sources: [{ datasetId: dataset.id, role: "input" }], outputs: [],
  tables: [{ title: "Summary", columns: ["value"], rows: [[1], [2], [3]] }],
  sourceFingerprint: analysisDataFingerprint(dataset), warnings: [], createdAt,
});

describe("statistical result workspace", () => {
  it("keeps only statistical producers and prioritizes the active worksheet", () => {
    const a = source("a", "Alpha");
    const b = source("b", "Beta");
    const visible = statisticalWorkspaceResults([
      result("old-active", "distribution-analysis", a, "2026-01-01T00:00:00Z"),
      result("new-other", "multivariate-analysis", b, "2026-02-01T00:00:00Z"),
      result("batch", "analysis-batch", a, "2026-03-01T00:00:00Z"),
      result("signal", "signal-processing", a, "2026-04-01T00:00:00Z"),
    ], [a, b], a.id, "");

    expect(visible.map((item) => item.result.id)).toEqual(["old-active", "new-other"]);
    expect(visible.map((item) => item.state)).toEqual(["current", "current"]);
  });

  it("searches interpretation, warning, source, and supports explicit current-only scope", () => {
    const a = source("a", "Anneal series");
    const b = source("b", "Control");
    const interpreted = {
      ...result("r1", "statistical-test", a, "invalid"),
      scalarValues: { Interpretation: "Groups differ" }, warnings: ["Unequal variance"],
    };
    const other = result("r2", "fit-y-by-x", b, "2026-01-01T00:00:00Z");

    expect(statisticalWorkspaceResults([interpreted, other], [a, b], a.id, "unequal", false)[0].result.id).toBe("r1");
    expect(statisticalWorkspaceResults([interpreted, other], [a, b], a.id, "anneal differ", false)[0].result.id).toBe("r1");
    expect(statisticalWorkspaceResults([interpreted, other], [a, b], a.id, "", true).map((item) => item.result.id)).toEqual(["r1"]);
  });

  it("bounds mounted table and row previews", () => {
    const ds = source("a", "Alpha");
    const tables = Array.from({ length: 7 }, (_, index) => ({
      title: `Table ${index}`, columns: ["value"], rows: Array.from({ length: 30 }, (__, row) => [row]),
    }));
    expect(statisticalTablePreviews({ ...result("r", "statistical-test", ds, "now"), tables })).toHaveLength(4);
    expect(statisticalTablePreviews({ ...result("r", "statistical-test", ds, "now"), tables })[0].rows).toHaveLength(20);
  });
});
