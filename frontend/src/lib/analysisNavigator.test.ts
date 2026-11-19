import { describe, expect, it } from "vitest";

import { recentAnalysisActions, resultsForDataset } from "./analysisNavigator";
import type { AnalysisResult } from "./analysisResult";
import type { Action } from "../store/commands";

const act = (id: string, group = "Analyze"): Action => ({ id, group, label: id, run: () => {} });
const result = (id: string, source: string, output?: string): AnalysisResult => ({
  version: 1, id, name: id, producer: { id: "curve-fit", label: "Curve Fit", version: 1 },
  sources: [{ datasetId: source, role: "input" }],
  outputs: output ? [{ datasetId: output, role: "linked-worksheet" }] : [],
  warnings: [], createdAt: "2026-01-01T00:00:00Z",
});

describe("recentAnalysisActions", () => {
  const actions = ["a", "b", "c", "d", "e", "f", "analysis-center"].map((id) => act(id)).concat(act("x", "Plot"));

  it("keeps recency order, caps at five, and drops unknown, non-Analyze and Analysis Center ids", () => {
    const recent = ["f", "gone", "x", "analysis-center", "e", "d", "c", "b", "a"];
    expect(recentAnalysisActions(actions, recent).map((a) => a.id)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("is empty with no history", () => {
    expect(recentAnalysisActions(actions, [])).toEqual([]);
  });
});

describe("resultsForDataset", () => {
  const all = [result("r1", "d1"), result("r2", "d2", "d1"), result("r3", "d3")];
  it("matches sources and outputs of the active worksheet only", () => {
    expect(resultsForDataset(all, "d1").map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(resultsForDataset(all, "d3").map((r) => r.id)).toEqual(["r3"]);
    expect(resultsForDataset(all, null)).toEqual([]);
    expect(resultsForDataset(all, "nope")).toEqual([]);
  });
});
