import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  migrateReflectivityFitAnalysisResults,
  reflectivityFitAnalysisResult,
} from "./reflFitAnalysisResult";
import { publishReflectivityFitAnalysisResult } from "../components/workshops/reflectivity/reflFitAnalysisResultPublish";

const dataset = (id: string, name = `${id}.refl`): Dataset => ({
  id,
  name,
  data: { time: [0.01, 0.02], values: [[1], [0.5]], labels: ["R"], units: [""], metadata: {} },
});

const stored = {
  version: 1,
  id: "rfit-1",
  seq: 2,
  fittedAt: "2026-10-09T00:00:00Z",
  request: {
    parameters: [], settings: {},
    channels: [
      { datasetId: "a", datasetName: "film.refl" },
      { datasetId: "b", datasetName: "reference.refl" },
    ],
  },
  result: { parameters: [], free: [], success: false, warnings: ["parameter at bound", 7] },
  model: { layers: [{}, {}], radiation: "xray" },
};

describe("reflectivity fit analysis catalog", () => {
  it("points to the existing record without copying its scientific payload", () => {
    expect(reflectivityFitAnalysisResult(stored, [dataset("a", "film.refl")])).toEqual({
      version: 1,
      id: "analysis-refl-fit-a-rfit-1",
      name: "Reflectivity fit #2 · film.refl",
      producer: { id: "reflectivity-fit", label: "Reflectivity Fit", version: 1 },
      sources: [
        { datasetId: "a", role: "input" },
        { datasetId: "b", role: "input" },
      ],
      outputs: [],
      settingsRef: { datasetId: "a", field: "reflFits", recordId: "rfit-1" },
      warnings: [],
      createdAt: "2026-10-09T00:00:00Z",
    });
  });

  it("deduplicates the record copied onto each participating dataset", () => {
    const datasets = [
      { ...dataset("a"), reflFits: [stored] },
      { ...dataset("b"), reflFits: [stored] },
    ];
    expect(migrateReflectivityFitAnalysisResults(datasets, [])).toHaveLength(1);
    expect(migrateReflectivityFitAnalysisResults(datasets, [{
      ...reflectivityFitAnalysisResult(stored, datasets)!, id: "kept", name: "Reviewed fit", notes: "accepted",
    }])).toMatchObject([{ id: "kept", name: "Reviewed fit", notes: "accepted" }]);
  });

  it("keeps same-named record ids from independent source projects distinct", () => {
    const other = {
      ...stored,
      request: { ...stored.request, channels: [{ datasetId: "c", datasetName: "other.refl" }] },
    };
    const migrated = migrateReflectivityFitAnalysisResults([
      { ...dataset("a"), reflFits: [stored] },
      { ...dataset("c"), reflFits: [other] },
    ], []);
    expect(migrated.map((result) => result.id)).toEqual([
      "analysis-refl-fit-a-rfit-1", "analysis-refl-fit-c-rfit-1",
    ]);
  });

  it("skips malformed stored history instead of creating a broken result", () => {
    expect(reflectivityFitAnalysisResult({ ...stored, request: { channels: [] } }, [dataset("a")])).toBeNull();
    expect(migrateReflectivityFitAnalysisResults([{ ...dataset("a"), reflFits: ["junk", 7] }], [])).toEqual([]);
  });

  it("publishes only the new fit, preserves deletion tombstones, and retires trimmed history", () => {
    const oldStored = { ...stored, id: "old", seq: 1 };
    const deletedStored = { ...stored, id: "deleted", seq: 3 };
    const oldResult = reflectivityFitAnalysisResult(oldStored, [dataset("a")])!;
    const nextDatasets = [{ ...dataset("a"), reflFits: [stored, deletedStored] }];
    const published = publishReflectivityFitAnalysisResult(nextDatasets, [oldResult], stored);
    expect(published.map((result) => result.settingsRef?.field === "reflFits" && result.settingsRef.recordId))
      .toEqual(["rfit-1"]);
    expect(published.some((result) => result.id.includes("deleted"))).toBe(false);
  });
});
