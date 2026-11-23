import { describe, expect, it } from "vitest";

import { findIdenticalBatchResult } from "./analysisBatchDedupe";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult } from "./analysisResult";

const result = (over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  version: ANALYSIS_RESULT_VERSION, id: "r1", name: "Batch — 1", producer: { id: "analysis-batch", label: "Fit", version: 1 },
  sources: [{ datasetId: "a", role: "input" }], outputs: [], parameters: { toolId: "fit" },
  tables: [{ title: "Batch status", columns: ["Worksheet"], rows: [["a"]] }], warnings: [], createdAt: "t", sourceFingerprint: "fp", ...over,
});

describe("findIdenticalBatchResult", () => {
  it("matches the same data, settings and tables whatever the id, name or time", () => {
    expect(findIdenticalBatchResult([result()], result({ id: "r2", name: "Batch — 2", createdAt: "u" }))?.id).toBe("r1");
  });
  it("does not match changed data, settings or numbers", () => {
    expect(findIdenticalBatchResult([result()], result({ sourceFingerprint: "other" }))).toBeUndefined();
    expect(findIdenticalBatchResult([result()], result({ parameters: { toolId: "fit", k: 2 } }))).toBeUndefined();
    expect(findIdenticalBatchResult([result()], result({ tables: [{ title: "Batch status", columns: ["Worksheet"], rows: [["b"]] }] }))).toBeUndefined();
  });
  it("fails open: a stale or fingerprintless result never matches or hides another", () => {
    expect(findIdenticalBatchResult([result({ stale: true })], result())).toBeUndefined();
    expect(findIdenticalBatchResult([result()], result({ stale: true }))).toBeUndefined();
    expect(findIdenticalBatchResult([result()], result({ sourceFingerprint: undefined }))).toBeUndefined();
  });
});

describe("recorded inputs never decide identity (acceptance C9)", () => {
  it("an identical run matches a result saved without the record", () => {
    const withInputs = result({ parameters: { toolId: "fit", inputs: { total: 1, items: [] } } });
    expect(findIdenticalBatchResult([result()], withInputs)?.id).toBe("r1");
    expect(findIdenticalBatchResult([withInputs], result())?.id).toBe("r1");
  });
});
