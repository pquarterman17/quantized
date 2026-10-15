import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { hysteresisBatchResultFigures, hysteresisTrendCandidates, metadataUnit, metadataUnits, numericMetadataValue } from "./hysteresisTrend";
import { statisticalResultFigureDrafts } from "./statisticalResultFigures";
import type { Dataset } from "./types";

const dataset = (id: string, metadata: Record<string, unknown>): Dataset => ({
  id, name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: ["emu"], metadata },
});

const result = (withTrend = true): AnalysisResult => ({
  version: 1,
  id: "batch",
  name: "Hysteresis comparison",
  producer: { id: "analysis-batch", label: "Hysteresis comparison", version: 1 },
  sources: [{ datasetId: "a", role: "input" }, { datasetId: "b", role: "input" }],
  outputs: [],
  parameters: {
    toolId: "hysteresis",
    ...(withTrend ? { hysteresisTrend: { label: "Temperature", unit: "K", column: "Series value", source: "manual" } } : {}),
  },
  tables: [{
    title: "Batch status",
    columns: [
      "Worksheet", "Status", "Rows", "Series value", "Mean |Hc|", "H unit",
      "Mean |Mr|", "Mean |Ms|", "M unit", "Squareness", "Loop area", "Area unit",
      "SFD peak H", "Warnings",
    ],
    rows: [
      ["a.dat", "Completed", 100, 100, 2, "Oe", 0.2, 1.0, "emu", 0.2, 5, "Oe·emu", 1.5, null],
      ["b.dat", "Completed", 100, 200, 3, "Oe", 0.3, 1.2, "emu", 0.25, 7, "Oe·emu", 2.2, null],
      ["c.dat", "Completed", 100, 300, 0.01, "T", 0.0002, 0.001, "A·m²", 0.2, 0.1, "T·A·m²", 0.008, null],
      ["failed.dat", "Failed", 0, 400, null, null, null, null, null, null, null, null, null, "failed"],
    ],
  }],
  warnings: [], createdAt: "2026-10-15T00:00:00Z", sourceFingerprint: "fingerprint",
});

describe("hysteresis trend figures", () => {
  it("requires an explicit saved axis and splits incompatible result units", () => {
    expect(hysteresisBatchResultFigures(result(false))).toEqual([]);
    const drafts = hysteresisBatchResultFigures(result());
    expect(drafts.map((draft) => draft.key)).toEqual([
      "hysteresis-fields-oe", "hysteresis-moments-emu", "hysteresis-squareness-undeclared",
      "hysteresis-loop-area-oe-emu",
    ]);
    expect(drafts[0].data.time).toEqual([100, 200]);
    expect(drafts[0].data.values).toEqual([[2, 1.5], [3, 2.2]]);
    expect(drafts[0].data.metadata).toMatchObject({ x_column_name: "Temperature", x_column_unit: "K" });
    expect(drafts.some((draft) => draft.data.units.includes("T"))).toBe(false);
    expect(statisticalResultFigureDrafts(result())[0].data.metadata).toMatchObject({
      analysisResultId: "batch", analysisProducer: "analysis-batch",
    });
  });

  it("keeps figure keys unique when different unit text has the same slug", () => {
    const source = result();
    const rows = source.tables![0].rows;
    rows.push(
      ["d.dat", "Completed", 100, 400, 4, "A/m", null, null, "", null, null, "", 3, null],
      ["e.dat", "Completed", 100, 500, 5, "A/m", null, null, "", null, null, "", 4, null],
      ["f.dat", "Completed", 100, 600, 6, "A m", null, null, "", null, null, "", 5, null],
      ["g.dat", "Completed", 100, 700, 7, "A m", null, null, "", null, null, "", 6, null],
    );
    const keys = hysteresisBatchResultFigures(source).map((draft) => draft.key);
    expect(keys).toContain("hysteresis-fields-a-m");
    expect(keys).toContain("hysteresis-fields-a-m-2");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists finite scalar metadata without guessing a unit", () => {
    const sources = [
      dataset("a", { temperature: "100", temperature_unit: "K", nested: { value: 1 } }),
      dataset("b", { temperature: 200, temperature_unit: "K", angle: 45 }),
    ];
    expect(hysteresisTrendCandidates(sources)).toEqual([
      { key: "metadata:temperature", label: "Temperature", coverage: 2,
        values: { a: 100, b: 200 }, units: ["K"] },
      { key: "metadata:angle", label: "Angle", coverage: 1,
        values: { b: 45 }, units: [] },
    ]);
    expect(metadataUnit(sources, "temperature")).toBe("K");
    expect(metadataUnit(sources, "angle")).toBe("");
    expect(metadataUnits([...sources, dataset("c", { temperature: 300, temperature_unit: "°C" })], "temperature"))
      .toEqual(["°C", "K"]);
    expect(numericMetadataValue(" ")).toBeNull();
    expect(numericMetadataValue(true)).toBeNull();
  });

  it("offers stable scientific companion columns and hides parser bookkeeping", () => {
    const sources = [dataset("a", { x_column_index: 3, startup_axis_x: 2 }), dataset("b", { x_column_index: 3 })];
    sources[0].data.values = [[299.9], [300.0], [300.1]];
    sources[1].data.values = [[199.95], [200.0], [200.05]];
    for (const source of sources) { source.data.time = [0, 1, 2]; source.data.labels = ["Temperature"]; source.data.units = ["K"]; }
    expect(hysteresisTrendCandidates(sources)).toEqual([{
      key: "column:temperature", label: "Temperature", coverage: 2,
      values: { a: 300, b: 200 }, units: ["K"],
    }]);
  });
});
