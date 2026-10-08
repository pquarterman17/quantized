import { describe, expect, it } from "vitest";

import {
  migrateLegacySignalResults,
  sanitizeAnalysisResults,
  signalAnalysisResult,
} from "./analysisResult";
import type { Dataset } from "./types";

function source(): Dataset {
  return {
    id: "source",
    name: "Trace",
    data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["V", "V"], metadata: { xUnit: "s" } },
  };
}

function output(): Dataset {
  return {
    id: "output",
    name: "Trace (Smooth)",
    data: { time: [0, 1], values: [[1], [3]], labels: ["A"], units: ["V"], metadata: {} },
    derivedFrom: { datasetId: "source", pipeline: "Smooth" },
    analysisRecipe: {
      kind: "signal-correction",
      version: 1,
      operation: "Smooth",
      xUnit: "s",
      channels: [{ index: 0, label: "A", unit: "V" }],
      params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2, xTrimMin: 0, xTrimMax: 1 },
    },
  };
}

describe("analysis result envelope", () => {
  it("references the linked worksheet as the recipe authority instead of copying settings", () => {
    const result = signalAnalysisResult("r", source(), output(), "2026-10-08T00:00:00Z");
    expect(result).toMatchObject({
      id: "r",
      name: "Smooth · Trace",
      producer: { id: "signal-processing" },
      sources: [{ datasetId: "source" }],
      outputs: [{ datasetId: "output" }],
      settingsRef: { datasetId: "output", field: "analysisRecipe" },
    });
    expect(result).not.toHaveProperty("parameters");
    // No snapshot of the recipe's channels/range: they drift on rebind.
    expect(result).not.toHaveProperty("selection");
  });

  it("keeps an unknown producer and missing dataset references for future-compatible diagnostics", () => {
    const [result] = sanitizeAnalysisResults([{
      version: 1,
      id: "future",
      name: "Future result",
      producer: { id: "new-analysis", label: "New Analysis", version: 9 },
      sources: [{ datasetId: "missing", role: "input" }],
      outputs: [],
      scalarValues: { impossible: Number.POSITIVE_INFINITY },
      warnings: [],
      createdAt: "later",
    }]);
    expect(result.producer.id).toBe("new-analysis");
    expect(result.sources[0].datasetId).toBe("missing");
    expect(result.scalarValues).toBeUndefined();
  });

  it("drops malformed and duplicate-id records with a migration warning", () => {
    const warnings: string[] = [];
    const valid = signalAnalysisResult("same", source(), output(), "now")!;
    expect(sanitizeAnalysisResults([valid, { ...valid, name: "duplicate" }, { name: "broken" }], warnings)).toHaveLength(1);
    expect(warnings).toEqual([
      'analysis result "duplicate" could not be read and was dropped',
      'analysis result "broken" could not be read and was dropped',
    ]);
  });

  it("migrates only linked worksheets carrying a valid signal recipe with deterministic ids", () => {
    const migrated = migrateLegacySignalResults([source(), output(), { ...output(), id: "plain", derivedFrom: undefined }], "saved");
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ id: "analysis-output", createdAt: "saved" });
  });
});
