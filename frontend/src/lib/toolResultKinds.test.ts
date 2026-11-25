// The Time series, DOE and Profiler result kinds (owner decision 2026-11-25):
// save -> reopen (round trip) -> stale -> delete for each kind, the book and
// the freeze outputs they share with the other statistics results, and old
// projects reading exactly as before.

import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults, type AnalysisResult } from "./analysisResult";
import { enumerateFreezeOutputs } from "./analysisResultFreezeOutputs";
import { isSnapshotResult, snapshotResultDiagnostics, snapshotResultState, stampAnalysisResults } from "./analysisResultFreshness";
import { hasResultBook, resultBookModel } from "./resultBook";
import { savedSnapshotKey } from "./snapshotResultKey";
import { isStatisticalResult } from "./statisticalResultWorkspace";
import { doeDesignRecipe, doeEffectsRecipe, profilerRecipe, timeSeriesRecipe } from "./toolResultKinds";
import {
  designResult, designSource, effectsResult, fitResult, fitSource, profileResult, tsResult, tsSource,
} from "./toolResultKinds.testkit";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { distribution, fitYByX, source as statsSource } from "../components/workshops/analysisresults/resultBook.testkit";

interface Kind {
  name: string;
  result: () => AnalysisResult;
  datasets: () => Dataset[];
  /** The same project with the source data changed. */
  changed: () => Dataset[];
  tables: string[];
  figures: number;
}

const bump = (d: Dataset, col: number): Dataset => ({ ...d, data: { ...d.data, values: d.data.values.map((r, i) => i === 0 ? r.map((v, c) => c === col ? v + 1 : v) : r) } });
const filled = designSource([5, 11, 6, 12]);

const KINDS: Kind[] = [
  { name: "time series", result: tsResult, datasets: () => [tsSource], changed: () => [bump(tsSource, 0)],
    tables: ["Correlogram", "Ljung–Box"], figures: 2 },
  { name: "DOE design", result: designResult, datasets: () => [designSource()], changed: () => [bump(designSource(), 4)],
    tables: ["Design summary", "Factors", "Model terms", "Design runs"], figures: 0 },
  { name: "DOE effects", result: () => effectsResult(filled), datasets: () => [filled], changed: () => [bump(filled, 6)],
    tables: ["Effects", "Lenth summary"], figures: 2 },
  { name: "profiler", result: () => profileResult(), datasets: () => [fitSource], changed: () => [bump(fitSource, 1)],
    tables: ["Current prediction", "Factor settings", "Prediction trace: T"], figures: 1 },
];

/** The project's results: a profile needs its Fit Model result beside it. */
const resultsFor = (r: AnalysisResult): AnalysisResult[] => r.producer.id === "profiler" ? [fitResult(), r] : [r];

describe.each(KINDS)("$name result", (kind) => {
  it("is a snapshot statistics result with the shared book and freezable tables", () => {
    const r = kind.result();
    expect(isSnapshotResult(r)).toBe(true);
    expect(isStatisticalResult(r)).toBe(true);
    expect(r.outputs).toEqual([]);
    expect(r.parameters?.["algorithm"]).toMatchObject({ version: 1 });
    expect(r.parameters?.["inputs"]).toMatchObject({ total: 1, items: [{ datasetId: r.sources[0]!.datasetId }] });
    expect(hasResultBook(r)).toBe(true);
    const model = resultBookModel(r)!;
    expect(model.reopen).toBe(true);
    const tables = model.sections.filter((s) => s.kind === "table");
    expect(tables.map((s) => s.title)).toEqual(expect.arrayContaining(kind.tables));
    expect(tables.every((s) => s.kind === "table" && s.freezeBlocked === null)).toBe(true);
    expect(model.sections.filter((s) => s.kind === "figure")).toHaveLength(kind.figures);
    expect(enumerateFreezeOutputs(r, kind.datasets()).every((o) => o.freezable)).toBe(true);
    expect(savedSnapshotKey(r)).not.toBeNull();
  });

  it("round-trips a project save and reopen unchanged and current", () => {
    const r = kind.result();
    const [restored] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([r])));
    expect(restored).toEqual(r);
    const results = resultsFor(r);
    const reopened = parseWorkspace(serializeWorkspace({ datasets: kind.datasets(), analysisResults: results }));
    expect(reopened.analysisResults).toEqual(results);
    expect(snapshotResultState(reopened.analysisResults!.at(-1)!, reopened.datasets, reopened.analysisResults)).toBe("current");
  });

  it("goes out of date when its source changes, and stays so through a save", () => {
    const r = kind.result();
    const results = resultsFor(r);
    expect(snapshotResultState(r, kind.datasets(), results)).toBe("current");
    expect(snapshotResultState(r, kind.changed(), results)).toBe("out-of-date");
    expect(snapshotResultDiagnostics(r, "out-of-date")[0]).toMatch(/changed|edited/);
    const stamped = stampAnalysisResults(results, kind.changed(), []);
    expect(stamped.at(-1)!.stale).toBe(true);
    // Once stale, a key no longer blocks a new save.
    expect(savedSnapshotKey(stamped.at(-1)!)).toBeNull();
  });

  it("is source missing when its source worksheet is deleted", () => {
    const r = kind.result();
    expect(snapshotResultState(r, [], resultsFor(r))).toBe("source-missing");
  });

  it("has no book when its saved recipe does not parse (fail closed)", () => {
    const r = kind.result();
    const broken = { ...r, parameters: { ...r.parameters, recipe: { nonsense: true } } };
    expect(hasResultBook(broken)).toBe(false);
    expect(savedSnapshotKey(broken)).toBeNull();
    expect([timeSeriesRecipe, doeDesignRecipe, doeEffectsRecipe, profilerRecipe].map((parse) => parse(broken))).toEqual([null, null, null, null]);
  });
});

describe("DOE design freshness", () => {
  it("stays current while the responses are filled in (the design columns are unchanged)", () => {
    expect(snapshotResultState(designResult(), [designSource([5, 11, 6, 12])])).toBe("current");
  });

  it("is out of date when a design column is renamed or removed", () => {
    const d = designSource();
    const renamed = { ...d, data: { ...d.data, labels: d.data.labels.map((l) => l === "A" ? "Temp" : l) } };
    expect(snapshotResultState(designResult(), [renamed])).toBe("out-of-date");
    expect(snapshotResultDiagnostics(designResult(), "out-of-date")[0]).toMatch(/design column/);
  });
});

describe("profiler freshness against its Fit Model result", () => {
  it("is source missing, with a reason, when the Fit Model result is deleted", () => {
    const r = profileResult();
    expect(snapshotResultState(r, [fitSource], [r])).toBe("source-missing");
    expect(snapshotResultDiagnostics(r, "source-missing")[0]).toMatch(/Fit Model result .* was deleted/);
    // Saving keeps it as it is (not stale): an Undo may bring the Fit Model result back.
    expect(stampAnalysisResults([r], [fitSource], [])[0]!.stale).toBeUndefined();
    expect(snapshotResultState(r, [fitSource], [fitResult(), r])).toBe("current");
  });

  it("is out of date when the Fit Model result is stale or its model changed", () => {
    const r = profileResult();
    const fit = fitResult();
    expect(snapshotResultState(r, [fitSource], [{ ...fit, stale: true }, r])).toBe("out-of-date");
    const refit = { ...fit, parameters: { ...fit.parameters, model: { ...(fit.parameters!.model as object), coefficients: [3, 0.002] } } };
    expect(snapshotResultState(r, [fitSource], [refit, r])).toBe("out-of-date");
    expect(stampAnalysisResults([refit, r], [fitSource], [])[1]!.stale).toBe(true);
  });

  it("is never current without the project's results to judge it by", () => {
    expect(snapshotResultState(profileResult(), [fitSource])).toBe("pending");
  });

  it("is not changed by a rename or a note on the Fit Model result", () => {
    const r = profileResult();
    expect(snapshotResultState(r, [fitSource], [{ ...fitResult(), name: "renamed", notes: "checked" }, r])).toBe("current");
  });
});

describe("old projects", () => {
  it("read and save the existing statistics results exactly as before", () => {
    const results = [distribution(), fitYByX()];
    expect(stampAnalysisResults(results, [statsSource], [])).toEqual(results);
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [statsSource], analysisResults: results }));
    expect(reopened.analysisResults).toEqual(results);
    expect(reopened.analysisResults!.map((r) => snapshotResultState(r, reopened.datasets, reopened.analysisResults))).toEqual(["current", "current"]);
  });

  it("keep the committed Time series worksheet output a separate, linked result", () => {
    // "Add as worksheet" publishes producer "time-series" with an output; it is not one of the new kinds.
    const committed = { ...tsResult(), producer: { id: "time-series", label: "Time series", version: 1 }, outputs: [{ datasetId: "out", role: "linked-worksheet" as const }] };
    expect(isSnapshotResult(committed)).toBe(false);
    expect(hasResultBook(committed)).toBe(false);
  });
});
