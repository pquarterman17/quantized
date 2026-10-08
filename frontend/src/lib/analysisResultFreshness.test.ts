import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { dataFingerprint, stampAnalysisResults, staleAnalysisOutputs } from "./analysisResultFreshness";
import type { DataStruct, Dataset } from "./types";

const data = (cells: number[]): DataStruct => ({
  time: cells.map((_, i) => i), values: cells.map((v) => [v]), labels: ["Y"], units: [""], metadata: {},
});

const RESULT: AnalysisResult = {
  version: 1, id: "r", name: "r",
  producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
  sources: [{ datasetId: "s", role: "input" }],
  outputs: [{ datasetId: "o", role: "linked-worksheet" }],
  warnings: [], createdAt: "2026-10-08T00:00:00Z",
};

describe("dataFingerprint", () => {
  it("agrees across the JSON round trip that turns NaN into null and -0 into 0", () => {
    const live = data([1, NaN, -0, 2.5]);
    const reloaded = JSON.parse(JSON.stringify(live)) as DataStruct;
    expect(dataFingerprint(reloaded)).toBe(dataFingerprint(live));
  });

  it("changes when one cell or the shape changes", () => {
    expect(dataFingerprint(data([1, 2, 3]))).not.toBe(dataFingerprint(data([1, 2, 4])));
    expect(dataFingerprint(data([1, 2]))).not.toBe(dataFingerprint(data([1, 2, 0])));
  });
});

describe("stamp / stale round trip", () => {
  const ds = (id: string, d: DataStruct, extra: Partial<Dataset> = {}): Dataset => ({ id, name: id, data: d, ...extra });

  it("does not judge a result whose source is still a pending preview", () => {
    const [stamped] = stampAnalysisResults([RESULT], [ds("s", data([1])), ds("o", data([1]))], []);
    const pending = ds("s", data([7]), { pending: { kind: "bundle" } as unknown as Dataset["pending"] });
    expect(staleAnalysisOutputs([stamped], [pending, ds("o", data([1]))])).toEqual([]);
  });

  it("drops a stale flag once the output is current again", () => {
    const [stamped] = stampAnalysisResults([{ ...RESULT, stale: true }], [ds("s", data([1])), ds("o", data([1]))], []);
    expect(stamped.stale).toBeUndefined();
    expect(stamped.sourceFingerprint).toBe(dataFingerprint(data([1])));
  });
});
