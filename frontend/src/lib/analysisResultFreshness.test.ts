import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { staleAnalysisFits } from "./analysisFitFreshness";
import { analysisDataFingerprint, dataFingerprint, stampAnalysisResults, snapshotResultState } from "./analysisResultFreshness";
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

    // Once stale, always stale — even after the data is reverted. Only a new
    // run creates a current result; the shared predicate agrees.
    const [savedAgain] = stampAnalysisResults([changed], [ds("s", original)], []);
    expect(savedAgain).toMatchObject({ sourceFingerprint: analysisDataFingerprint(ds("s", original)), stale: true });
    expect(snapshotResultState(savedAgain, [ds("s", original)])).toBe("out-of-date");
  });

  it("never stamps a fingerprint onto a statistical snapshot that lacks one", () => {
    const stat: AnalysisResult = {
      ...RESULT, outputs: [], producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
      parameters: { testId: "anderson" },
    };
    const [saved] = stampAnalysisResults([stat], [ds("s", data([2]))], []);
    expect(saved).not.toHaveProperty("sourceFingerprint");
    expect(saved.stale).toBe(true);
    expect(snapshotResultState(stat, [ds("s", data([2]))])).toBe("out-of-date");
    const power: AnalysisResult = { ...stat, sources: [], parameters: { testId: "power" } };
    expect(stampAnalysisResults([power], [], [])[0]).toEqual(power);
    expect(snapshotResultState(power, [])).toBe("current");
  });

  it("judges a statistical snapshot through one shared predicate", () => {
    const source = ds("s", data([1, 2]));
    const stat: AnalysisResult = {
      ...RESULT, outputs: [], producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
      parameters: { testId: "anderson" }, sourceFingerprint: analysisDataFingerprint(source),
    };
    expect(snapshotResultState(stat, [source])).toBe("current");
    expect(snapshotResultState(stat, [ds("s", data([1, 3]))])).toBe("out-of-date");
    // A lazily loaded book's data is only a preview: it can't be judged.
    const pending = { ...source, pending: { kind: "path", path: "p", book: "b" } } as unknown as Dataset;
    expect(snapshotResultState(stat, [pending])).toBe("pending");
    expect(snapshotResultState(stat, [])).toBe("source-missing");
    // A non-power result that lost its source reference is source-missing,
    // not a sourceless "current" result.
    expect(snapshotResultState({ ...stat, sources: [] }, [source])).toBe("source-missing");
    expect(snapshotResultState({ ...stat, stale: true }, [source])).toBe("out-of-date");
  });

  it("marks statistics stale when row exclusions change their analysis input", () => {
    const source = ds("s", data([1, 2]));
    const [current] = stampAnalysisResults([{
      ...RESULT, outputs: [], producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
      sourceFingerprint: analysisDataFingerprint(source),
    }], [source], []);
    expect(current.stale).toBeUndefined();
    const [changed] = stampAnalysisResults([current], [{ ...source, excludedRows: [1] }], []);
    expect(changed.stale).toBe(true);
  });

  it("marks statistics stale when categorical meaning changes without numeric edits", () => {
    const source = ds("s", { ...data([0, 1]), cat_levels: { 0: ["control", "film"] } });
    const [current] = stampAnalysisResults([{
      ...RESULT, outputs: [], producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
      sourceFingerprint: analysisDataFingerprint(source),
    }], [source], []);
    expect(current.stale).toBeUndefined();
    const relabeled = { ...source, data: { ...source.data, cat_levels: { 0: ["reference", "film"] } } };
    const [changed] = stampAnalysisResults([current], [relabeled], []);
    expect(changed.stale).toBe(true);
  });

  it("applies the same source-only freshness contract to Distribution snapshots", () => {
    const source = ds("s", data([1, 2]));
    const [current] = stampAnalysisResults([{
      ...RESULT, outputs: [], producer: { id: "distribution-analysis", label: "Distribution", version: 1 },
      sourceFingerprint: analysisDataFingerprint(source),
    }], [source], []);
    expect(current.stale).toBeUndefined();
    const [changed] = stampAnalysisResults([current], [{ ...source, excludedRows: [] }], []);
    expect(changed.sourceFingerprint).toBe(current.sourceFingerprint);
    expect(changed.stale).toBeUndefined();
    const [edited] = stampAnalysisResults([current], [{ ...source, data: data([1, 3]) }], []);
    expect(edited.stale).toBe(true);
    // Only a statistical power test is sourceless; a Distribution result that
    // lost its source reference is source-missing.
    expect(snapshotResultState({ ...current, sources: [] }, [source])).toBe("source-missing");
  });

  it("applies the snapshot freshness contract to Fit Y by X results", () => {
    const source = ds("s", data([1, 2]));
    const fitYByX: AnalysisResult = {
      ...RESULT, outputs: [], producer: { id: "fit-y-by-x", label: "Fit Y by X", version: 1 },
      sourceFingerprint: analysisDataFingerprint(source),
    };
    expect(snapshotResultState(fitYByX, [source])).toBe("current");
    const [changed] = stampAnalysisResults([fitYByX], [ds("s", data([1, 3]))], []);
    expect(changed).toMatchObject({ sourceFingerprint: fitYByX.sourceFingerprint, stale: true });
    expect(snapshotResultState(changed, [source])).toBe("out-of-date");
    expect(snapshotResultState({ ...fitYByX, sources: [] }, [source])).toBe("source-missing");
  });

  it("applies the snapshot freshness contract to Variability results", () => {
    const source = ds("s", data([1, 2]));
    const variability: AnalysisResult = {
      ...RESULT, outputs: [], producer: { id: "variability-analysis", label: "Variability", version: 1 },
      sourceFingerprint: analysisDataFingerprint(source),
    };
    expect(snapshotResultState(variability, [source])).toBe("current");
    const [changed] = stampAnalysisResults([variability], [ds("s", data([1, 3]))], []);
    expect(changed).toMatchObject({ sourceFingerprint: variability.sourceFingerprint, stale: true });
    expect(snapshotResultState(changed, [source])).toBe("out-of-date");
  });
});
