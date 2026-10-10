import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { staleAnalysisFits } from "./analysisFitFreshness";
import { analysisDataFingerprint, dataFingerprint, stampAnalysisResults } from "./analysisResultFreshness";
import { staleAnalysisOutputs } from "./analysisResultStaleLoad";
import type { PeakTable } from "./peakTable";
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

  it("leaves peak freshness to the authoritative peak-table fingerprint", () => {
    const peak: AnalysisResult = {
      ...RESULT,
      outputs: [],
      settingsRef: { datasetId: "s", field: "peakTable" },
      sourceFingerprint: "obsolete-generic-fingerprint",
      stale: true,
    };
    const [stamped] = stampAnalysisResults([peak], [ds("s", data([1]))], ["s"]);
    expect(stamped).not.toHaveProperty("sourceFingerprint");
    expect(stamped).not.toHaveProperty("stale");
  });

  it("persists a stale flag when a peak table no longer matches its source", () => {
    const table: PeakTable = {
      version: 1, peaks: [],
      provenance: {
        datasetId: "s", datasetName: "s", method: "simultaneous", model: "Gaussian",
        bgDegree: 0, linkMode: "None", constrain: false, bgCoeffs: [], R2: null, rmse: null,
        wavelengthA: null, xLabel: "x", xUnit: "", fingerprint: "different", fittedAt: "now",
      },
    };
    const peak: AnalysisResult = {
      ...RESULT, outputs: [], settingsRef: { datasetId: "s", field: "peakTable" },
    };
    const [stamped] = stampAnalysisResults([peak], [ds("s", data([1]), { peakTable: table })], []);
    expect(stamped.stale).toBe(true);
    expect(stamped).not.toHaveProperty("sourceFingerprint");
  });

  it("round-trips fit freshness independently of linked output freshness", () => {
    const fit: AnalysisResult = {
      ...RESULT, outputs: [],
      settingsRef: { datasetId: "s", field: "fitSpec" },
    };
    const source = ds("s", data([1]), { fitSpec: { model: "Linear", yKey: 0 } });
    const [current] = stampAnalysisResults([fit], [source], [], []);
    expect(staleAnalysisFits([current], [source])).toEqual([]);
    expect(staleAnalysisFits([current], [{ ...source, data: data([2]) }])).toEqual(["s"]);
    const [marked] = stampAnalysisResults([current], [source], [], ["s"]);
    expect(marked.stale).toBe(true);
    expect(staleAnalysisFits([marked], [source])).toEqual(["s"]);
  });

  it("never blesses a stale source-only statistical snapshot during save", () => {
    const original = data([1]);
    const stat: AnalysisResult = {
      ...RESULT,
      producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
      outputs: [], sourceFingerprint: analysisDataFingerprint(ds("s", original)),
    };
    const [changed] = stampAnalysisResults([stat], [ds("s", data([2]))], []);
    expect(changed).toMatchObject({ sourceFingerprint: analysisDataFingerprint(ds("s", original)), stale: true });

    const [savedAgain] = stampAnalysisResults([changed], [ds("s", original)], []);
    expect(savedAgain).toMatchObject({ sourceFingerprint: analysisDataFingerprint(ds("s", original)) });
    expect(savedAgain.stale).toBeUndefined();
  });

  it("marks statistics stale when row exclusions change their analysis input", () => {
    const source = ds("s", data([1, 2]));
    const [current] = stampAnalysisResults([{
      ...RESULT, outputs: [], producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
    }], [source], []);
    const [changed] = stampAnalysisResults([current], [{ ...source, excludedRows: [1] }], []);
    expect(changed.stale).toBe(true);
  });

  it("marks statistics stale when categorical meaning changes without numeric edits", () => {
    const source = ds("s", { ...data([0, 1]), cat_levels: { 0: ["control", "film"] } });
    const [current] = stampAnalysisResults([{
      ...RESULT, outputs: [], producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
    }], [source], []);
    const relabeled = { ...source, data: { ...source.data, cat_levels: { 0: ["reference", "film"] } } };
    const [changed] = stampAnalysisResults([current], [relabeled], []);
    expect(changed.stale).toBe(true);
  });
});
