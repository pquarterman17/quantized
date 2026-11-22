// A linked Signal Processing output whose recipe reads the analysis view
// (`inputRows: "analysis-view"`) depends on the source's exclusions and Data
// Filter, so its saved freshness fingerprint must see them (lane SEL4). A
// full-worksheet recipe keeps the raw-data hash.
import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { dataFingerprint, stampAnalysisResults } from "./analysisResultFreshness";
import { staleAnalysisOutputs } from "./analysisResultStaleLoad";
import type { SignalCorrectionRecipe } from "./signalRecipe";
import type { DataStruct, Dataset } from "./types";

const data = (cells: number[]): DataStruct => ({
  time: cells.map((_, i) => i), values: cells.map((v) => [v]), labels: ["Y"], units: [""], metadata: {},
});
const RESULT: AnalysisResult = {
  version: 1, id: "r", name: "r",
  producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
  sources: [{ datasetId: "s", role: "input" }],
  outputs: [{ datasetId: "o", role: "linked-worksheet" }],
  warnings: [], createdAt: "2026-11-22T00:00:00Z",
};
const recipe = (rows: boolean): SignalCorrectionRecipe => ({
  kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "",
  channels: [{ index: 0, label: "Y", unit: "" }],
  params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
  ...(rows ? { inputRows: "analysis-view" as const } : {}),
});
const source = (extra: Partial<Dataset> = {}): Dataset => ({ id: "s", name: "s", data: data([1, 2, 3, 4]), ...extra });
const output = (rows: boolean): Dataset => ({
  id: "o", name: "o", data: data([1, 2, 3, 4]), derivedFrom: { datasetId: "s", pipeline: "Smooth" }, analysisRecipe: recipe(rows),
});

describe("linked output freshness and the source's row state", () => {
  it("analysis-view recipe: an exclusion made after the stamp is out of date on load", () => {
    const [stamped] = stampAnalysisResults([RESULT], [source(), output(true)], []);
    expect(staleAnalysisOutputs([stamped], [source(), output(true)])).toEqual([]);
    expect(staleAnalysisOutputs([stamped], [source({ excludedRows: [1] }), output(true)])).toEqual(["o"]);
  });

  it("analysis-view recipe: a Data Filter made after the stamp is out of date on load", () => {
    const [stamped] = stampAnalysisResults([RESULT], [source(), output(true)], []);
    const filtered = source({ filter: [{ col: 0, kind: "range", min: 2 }] });
    expect(staleAnalysisOutputs([stamped], [filtered, output(true)])).toEqual(["o"]);
  });

  it("full-worksheet recipe: the raw-data hash is unchanged and ignores exclusions", () => {
    const [stamped] = stampAnalysisResults([RESULT], [source(), output(false)], []);
    expect(stamped.sourceFingerprint).toBe(dataFingerprint(data([1, 2, 3, 4])));
    expect(staleAnalysisOutputs([stamped], [source({ excludedRows: [1] }), output(false)])).toEqual([]);
  });
});
