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

  it("round-trips bounded producer parameters and inline tables", () => {
    const base = signalAnalysisResult("inline", source(), output(), "now")!;
    const [result] = sanitizeAnalysisResults([{
      ...base,
      parameters: { testId: "anderson", selection: { x: 0, cols: [0, 1] }, enabled: true },
      tables: [{ title: "Statistics", columns: ["name", "value"], rows: [["A²", 0.42], ["p", null]] }],
    }]);
    expect(result.parameters).toEqual({ testId: "anderson", selection: { x: 0, cols: [0, 1] }, enabled: true });
    expect(result.tables).toEqual([{ title: "Statistics", columns: ["name", "value"], rows: [["A²", 0.42], ["p", null]] }]);

    const [malformed] = sanitizeAnalysisResults([{ ...base, tables: [{ columns: ["only"], rows: [[1, 2]] }] }]);
    expect(malformed.tables).toBeUndefined();

    const wideTree = { branches: Array.from({ length: 101 }, () => Array(1_000).fill(1)) };
    const [overBudget] = sanitizeAnalysisResults([{ ...base, parameters: wideTree }]);
    expect(overBudget.parameters).toBeUndefined();
  });

  it("keeps but marks an unsupported batch-selection version out of date", () => {
    const [result] = sanitizeAnalysisResults([{
      version: 1,
      id: "batch",
      name: "Old batch",
      producer: { id: "analysis-batch", label: "Batch", version: 1 },
      sources: [{ datasetId: "source", role: "input" }],
      outputs: [],
      parameters: { selection: { version: 99, items: [] } },
      warnings: [],
      createdAt: "now",
    }]);
    expect(result.stale).toBe(true);
    expect(result.warnings[0]).toContain("selection version is unsupported");
  });

  it("migrates legacy Outlier row evidence to the worksheet's one-based numbering", () => {
    const [result] = sanitizeAnalysisResults([{
      version: 1, id: "old-outlier", name: "Old outlier screen",
      producer: { id: "outlier-screening", label: "Outlier screening", version: 1 },
      sources: [{ datasetId: "source", role: "input" }], outputs: [],
      tables: [
        { title: "Flagged rows", columns: ["source row", "value"], rows: [[2, 99]] },
        { title: "Rosner sequence", columns: ["step", "source row"], rows: [[1, 0], [2, null]] },
      ],
      warnings: ["2 non-finite source rows were omitted from the test: 3, 8."],
      createdAt: "then",
    }]);
    expect(result.producer.version).toBe(2);
    expect(result.tables).toEqual([
      { title: "Flagged rows", columns: ["source row", "value"], rows: [[3, 99]] },
      { title: "Rosner sequence", columns: ["step", "source row"], rows: [[1, 1], [2, null]] },
    ]);
    expect(result.warnings).toEqual(["2 non-finite source rows were omitted from the test: 4, 9."]);
  });

  it("migrates only linked worksheets carrying a valid signal recipe with deterministic ids", () => {
    const migrated = migrateLegacySignalResults([source(), output(), { ...output(), id: "plain", derivedFrom: undefined }], "saved");
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ id: "analysis-output", createdAt: "saved" });
  });

  it("keeps a legacy output's result when its source is not in the file, naming the missing source", () => {
    const migrated = migrateLegacySignalResults([output()], "saved");
    expect(migrated).toEqual([{
      version: 1,
      id: "analysis-output",
      name: "Smooth · Trace (Smooth)",
      producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
      sources: [{ datasetId: "source", role: "input" }],
      outputs: [{ datasetId: "output", role: "linked-worksheet" }],
      settingsRef: { datasetId: "output", field: "analysisRecipe" },
      tableRefs: [{ datasetId: "output", label: "Trace (Smooth)" }],
      plotBindings: [{ datasetId: "output", channels: [0] }],
      warnings: [],
      createdAt: "saved",
    }]);
    // The kept record passes the loader's sanitizer untouched.
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    // A recipe-less output is still not an analysis result.
    expect(migrateLegacySignalResults([{ ...output(), analysisRecipe: undefined }], "saved")).toEqual([]);
  });
});
