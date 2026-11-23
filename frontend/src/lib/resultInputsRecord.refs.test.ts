// The multi-output envelope (acceptance C13, audit rows 26/27) and the pointer to
// a dataset-resident record (acceptance C9, audit row 35); owner-approved
// recommendation 2026-11-23.
import { describe, expect, it } from "vitest";

import { analysisResultDiagnostics } from "../components/workshops/analysisresults/analysisResultDiagnostics";
import { COMMITTED_OUTPUT_STALE } from "../components/workshops/analysisresults/analysisResultPanelText";
import { encodeRecord } from "../components/workshops/reflectivity/reflFitRecord";
import { makeRecord } from "../components/workshops/reflectivity/reflFit.testkit";
import { commitKeyFor } from "../store/analysisOutputCommit";
import { sanitizeAnalysisResults, type AnalysisResult } from "./analysisResult";
import { findCommittedResultId } from "./committedOutput";
import { fitAnalysisResult } from "./fitAnalysisResultLive";
import { migrateFitAnalysisResults } from "./fitAnalysisResult";
import { peakAnalysisResult } from "./peakAnalysisResult";
import type { PeakTable } from "./peakTable";
import { peakDataFingerprint } from "./peakTableFreshness";
import { reflectivityFitAnalysisResult } from "./reflFitAnalysisResult";
import { recordChangedText, recordFingerprint, referencedRecordState } from "./resultInputsRecord";
import type { Dataset, FitSpec } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const sheet = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1, 2, 3, 4], values: [[1, 10], [2, 20], [3, 30], [4, 40], [5, 50]], labels: ["x", "y"], units: ["K", "emu"], metadata: {} },
  ...over,
});

const committed = (outputs: AnalysisResult["outputs"], over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  version: 1, id: "r", name: "Result", producer: { id: "p", label: "P", version: 1 },
  sources: [{ datasetId: "src", role: "input" }], outputs,
  parameters: { commitKey: "key" }, warnings: [], createdAt: "2026-11-23T00:00:00Z", ...over,
});

const SPEC: FitSpec = {
  model: "Linear", xKey: 0, yKey: 1, params: [10, 0], errors: [0.1, null], R2: 1, range: [2, 4], nPoints: 3,
  fittedAt: "2026-11-23T00:00:00Z", weight: { mode: "yerr", errKey: 0 },
};

describe("multi-output envelope (C13)", () => {
  it("an old single-output envelope (no part, no record fingerprint) loads exactly as saved", () => {
    const old = {
      ...committed([{ datasetId: "out", role: "linked-worksheet" }]),
      settingsRef: { datasetId: "src", field: "fitSpec" as const },
      tableRefs: [{ datasetId: "out", label: "Out" }],
    };
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([old])))).toEqual([old]);
  });

  it("keeps every output with its part; a malformed part is dropped, never the output or the result", () => {
    const raw = committed([
      { datasetId: "a", role: "linked-worksheet", part: "model" },
      { datasetId: "b", role: "linked-worksheet", part: 7 as unknown as string },
      { datasetId: "c", role: "linked-worksheet", part: "x".repeat(65) },
    ]);
    expect(sanitizeAnalysisResults([raw])[0].outputs).toEqual([
      { datasetId: "a", role: "linked-worksheet", part: "model" },
      { datasetId: "b", role: "linked-worksheet" },
      { datasetId: "c", role: "linked-worksheet" },
    ]);
  });

  it("a multi-output result is the current one for its key only while EVERY output exists and none is stale", () => {
    const result = committed([{ datasetId: "a", role: "linked-worksheet" }, { datasetId: "b", role: "linked-worksheet", part: "sld" }]);
    const all = [sheet("a"), sheet("b")];
    expect(findCommittedResultId([result], all, [], "key")).toBe("r");
    expect(findCommittedResultId([result], [sheet("a")], [], "key")).toBeNull();
    expect(findCommittedResultId([result], all, ["b"], "key")).toBeNull();
  });

  it("single-output results: the lookup and the commit key are unchanged", () => {
    const result = committed([{ datasetId: "a", role: "linked-worksheet" }]);
    expect(findCommittedResultId([result], [sheet("a")], [], "key")).toBe("r");
    expect(findCommittedResultId([result], [sheet("a")], ["a"], "key")).toBeNull();
    expect(findCommittedResultId([result], [], [], "key")).toBeNull();
    expect(commitKeyFor({ producer: { id: "surface-fit", label: "S", version: 1 }, sourceId: "src", computedOn: "fp", settings: { model: "Plane" } }))
      .toBe('["surface-fit","src","fp",{"model":"Plane"}]');
  });

  it("diagnostics: a stale NON-primary output marks the result out of date", () => {
    const result = committed([{ datasetId: "a", role: "linked-worksheet" }, { datasetId: "b", role: "linked-worksheet" }]);
    const datasets = [sheet("src"), sheet("a"), sheet("b")];
    const base = {
      result, datasets, source: datasets[0], output: datasets[1], staleFits: [], isPeak: false, isFit: false, isRefl: false,
      peakTable: null, fitSpec: null, fitFingerprintStale: false, reflFit: null, reflIssues: { missing: [], changed: [] }, snapshotState: null,
    };
    expect(analysisResultDiagnostics({ ...base, staleDatasets: [] })).toEqual([]);
    expect(analysisResultDiagnostics({ ...base, staleDatasets: ["b"] })).toEqual([COMMITTED_OUTPUT_STALE]);
  });
});

describe("the record a result points at (C9 row 35)", () => {
  it("the fingerprint covers what the record says, not where it points", () => {
    const fp = recordFingerprint("fitSpec", SPEC);
    expect(recordFingerprint("fitSpec", { ...SPEC, xKey: null, yKey: 3, weight: { mode: "yerr", errKey: 4 } })).toBe(fp);
    expect(recordFingerprint("fitSpec", { ...SPEC, params: [10, 1] })).not.toBe(fp);
    expect(recordFingerprint("fitSpec", { ...SPEC, weight: { mode: "poisson" } })).not.toBe(fp);
    expect(recordFingerprint("fitSpec", null)).toBeNull();
    const stored = encodeRecord(makeRecord());
    const remapped = JSON.parse(JSON.stringify(stored));
    remapped.request.channels[0].datasetId = "elsewhere";
    remapped.posterior = { parameters: [] };
    remapped.curves = undefined;
    expect(recordFingerprint("reflFits", remapped)).toBe(recordFingerprint("reflFits", stored));
  });

  it("a save and reopen keeps every record 'current' (fit, peak table, reflectivity fit)", () => {
    const fitted = sheet("fit", { fitSpec: SPEC });
    const base = sheet("pk");
    const peaked = sheet("pk", { peakTable: peakTable(base, { rowIds: [3, 1, 2] }) });
    const refl = sheet("xrr", { reflFits: [encodeRecord(makeRecord({}, ["xrr"]))] });
    const results = [
      fitAnalysisResult(fitted, SPEC), peakAnalysisResult(peaked, peaked.peakTable!, 1, 0),
      reflectivityFitAnalysisResult(refl.reflFits![0], [refl])!,
    ];
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [fitted, peaked, refl], analysisResults: results }));
    expect(reopened.analysisResults?.map((r) => r.settingsRef?.fingerprint)).toEqual(results.map((r) => r.settingsRef?.fingerprint));
    for (const result of reopened.analysisResults ?? []) expect(referencedRecordState(result, reopened.datasets)).toBe("current");
  });

  it("states: current, changed (a different record), missing, and unrecorded (old envelope or lazy preview)", () => {
    const fitted = sheet("fit", { fitSpec: SPEC });
    const result = fitAnalysisResult(fitted, SPEC);
    expect(referencedRecordState(result, [fitted])).toBe("current");
    expect(referencedRecordState(result, [{ ...fitted, fitSpec: { ...SPEC, params: [3, 3] } }])).toBe("changed");
    expect(referencedRecordState(result, [{ ...fitted, fitSpec: undefined }])).toBe("missing");
    const { fingerprint: _fp, ...legacyRef } = result.settingsRef!;
    expect(referencedRecordState({ ...result, settingsRef: legacyRef }, [{ ...fitted, fitSpec: { ...SPEC, params: [3, 3] } }])).toBe("unrecorded");
    expect(referencedRecordState(result, [{ ...fitted, pending: {} } as unknown as Dataset])).toBe("unrecorded");
  });

  it("a changed record is withheld in the diagnostics with the reason, not reported as missing", () => {
    const fitted = sheet("fit", { fitSpec: SPEC });
    const result = fitAnalysisResult(fitted, SPEC);
    const diagnostics = analysisResultDiagnostics({
      result, datasets: [fitted], source: fitted, output: undefined, staleDatasets: [], staleFits: [], isPeak: false, isFit: true,
      isRefl: false, peakTable: null, fitSpec: null, fitFingerprintStale: false, reflFit: null, reflIssues: { missing: [], changed: [] },
      snapshotState: null, recordChanged: true,
    });
    expect(diagnostics).toContain(recordChangedText("fitSpec"));
    expect(diagnostics.join(" ")).not.toMatch(/no longer available/);
  });

  it("a curve-fit result records the rows, X range and channels the fit consumed", () => {
    const source = sheet("fit", { excludedRows: [3], fitSpec: SPEC });
    // X (column 0) in [2, 5], minus excluded row 3 (x = 4): rows 1, 2 and 4 (x = 2, 3, 5).
    const spec: FitSpec = { ...SPEC, range: [2, 5], nPoints: 3 };
    const result = fitAnalysisResult(source, spec);
    expect(result.parameters?.["inputs"]).toEqual({ total: 1, items: [expect.objectContaining({
      datasetId: "fit", rows: 5, includedRows: 3, xRange: [2, 5], xLabel: "x", xUnit: "K",
      channels: [{ index: 0, label: "x", unit: "K" }, { index: 1, label: "y", unit: "emu" }],
    })] });
  });

  it("no curve-fit inputs (fail closed) when the rows no longer rebuild, for a legacy spec, or on migration", () => {
    const source = sheet("fit", { fitSpec: SPEC });
    expect(fitAnalysisResult(source, { ...SPEC, nPoints: 4 }).parameters).toBeUndefined();
    expect(fitAnalysisResult(source, { model: "Linear", params: [1, 1] }).parameters).toBeUndefined();
    const [migrated] = migrateFitAnalysisResults([source], [], "2026-11-23T00:00:00Z");
    expect(migrated.parameters).toBeUndefined();
    expect(migrated.settingsRef?.fingerprint).toBe(recordFingerprint("fitSpec", SPEC));
  });

  it("a peak result records its inputs only while the table's data fingerprint matches", () => {
    const base = sheet("pk", { excludedRows: [0] });
    const table = peakTable(base);
    const result = peakAnalysisResult({ ...base, peakTable: table }, table, 1, 0);
    expect(result.parameters?.["inputs"]).toEqual({ total: 1, items: [expect.objectContaining({ includedRows: 4, xRange: [2, 5] })] });
    const subset = peakTable(base, { rowIds: [1, 2] });
    expect(peakAnalysisResult({ ...base, peakTable: subset }, subset, 1, 0).parameters?.["inputs"])
      .toEqual({ total: 1, items: [expect.objectContaining({ includedRows: 2, xRange: [2, 3] })] });
    const edited = { ...base, data: { ...base.data, values: base.data.values.map((r) => [r[0]!, r[1]! + 1]) } };
    expect(peakAnalysisResult({ ...edited, peakTable: table }, table, 1, 0).parameters).toBeUndefined();
    const unknown = { ...table, provenance: { ...table.provenance, fingerprint: null } };
    expect(peakAnalysisResult({ ...base, peakTable: unknown }, unknown, 1, 0).parameters).toBeUndefined();
  });
});

function peakTable(ds: Dataset, over: { rowIds?: number[] } = {}): PeakTable {
  return {
    version: 1,
    peaks: [{ id: "peak-1", center: 3, centerErr: null, fwhm: 0.5, fwhmErr: null, height: 30, heightErr: null, area: 15, bg: 0, eta: null, model: "Gaussian", status: "fitted", excluded: false }],
    provenance: {
      datasetId: ds.id, datasetName: ds.name, method: "simultaneous", model: "Gaussian", bgDegree: 0, linkMode: "None",
      constrain: false, bgCoeffs: [], R2: null, rmse: null, wavelengthA: null, xLabel: "x", xUnit: "K",
      fingerprint: peakDataFingerprint(ds, over.rowIds ? [...over.rowIds].sort((a, b) => a - b) : undefined),
      fittedAt: "2026-11-23T00:00:00Z", ...(over.rowIds ? { rowIds: over.rowIds } : {}),
    },
  };
}
