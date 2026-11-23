// The interactive transforms (Reshape, Dataset math, SIMS, Signal filter) on the
// shared result contract (result audit row 25): one undo step, a recorded result
// with inputs, a repeat adds nothing, Out of date when ANY input changes; a
// recorded macro step only for a real creation.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INPUTS_PARAM } from "../lib/resultInputsRecord";
import type { Dataset } from "../lib/types";
import { commitTransformOutput } from "./commitTransformOutput";
import { useApp } from "./useApp";

const { algebra, compare } = vi.hoisted(() => ({ algebra: vi.fn(), compare: vi.fn() }));
vi.mock("../lib/api/datasetAlgebra", () => ({ datasetAlgebra: algebra }));
vi.mock("../lib/api/sims", () => ({ compareSims: compare, processSims: vi.fn() }));

const sheet = (id: string, ys: number[]): Dataset => ({
  id, name: `${id}.dat`, data: { time: ys.map((_, i) => i), values: ys.map((y) => [y, y * 2]), labels: ["A", "B"], units: ["V", "V"], metadata: {} },
});
const outputs = () => useApp.getState().datasets.filter((d) => !["a", "b"].includes(d.id));

beforeEach(() => {
  vi.clearAllMocks();
  compare.mockResolvedValue({ dataset: { time: [0, 1], values: [[1], [2]], labels: ["B"], units: ["c"], metadata: {} }, warnings: [], traces: [] });
  algebra.mockResolvedValue({ time: [0, 1], values: [[3], [4]], labels: ["A+B"], units: ["V"], metadata: {} });
  useApp.setState({
    datasets: [sheet("a", [1, 2]), sheet("b", [3, 4])], activeId: "a", selectedIds: ["a"], macroRecording: true, macroSteps: [],
    analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual",
  });
});

describe("commitTransformOutput over the reshape and math ops", () => {
  it("transpose: one undo step, a recorded result, one macro step", async () => {
    const out = await commitTransformOutput(useApp.getState, { op: "transpose" }, "a");
    expect(out?.existing).toBeUndefined();
    const s = useApp.getState();
    expect(outputs()).toHaveLength(1);
    expect(s.history).toHaveLength(1);
    expect(s.macroSteps).toHaveLength(1);
    const [result] = s.analysisResults;
    expect(result!.producer).toEqual({ id: "transform-transpose", label: "Transpose", version: 1 });
    expect(result!.sources).toEqual([{ datasetId: "a", role: "input" }]);
    expect(result!.parameters?.[INPUTS_PARAM]).toBeTruthy();
    s.undo();
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("a repeat adds nothing, records no second step, and says so; Undo allows it again", async () => {
    await commitTransformOutput(useApp.getState, { op: "transpose" }, "a");
    const again = await commitTransformOutput(useApp.getState, { op: "transpose" }, "a");
    expect(again?.existing).toBe(true);
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().macroSteps).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/already added/);
    useApp.getState().undo();
    await commitTransformOutput(useApp.getState, { op: "transpose" }, "a");
    expect(outputs()).toHaveLength(1);
  });

  it("different settings are a different output, not a duplicate", async () => {
    await commitTransformOutput(useApp.getState, { op: "stack", channels: [0] }, "a");
    await commitTransformOutput(useApp.getState, { op: "stack", channels: [0, 1] }, "a");
    expect(outputs()).toHaveLength(2);
  });

  it("dataset math: both operands are sources; changing EITHER marks the output out of date", async () => {
    const p = { op: "algebra" as const, operation: "A+B", interp: "linear", with: { id: "b", name: "b.dat" } };
    await commitTransformOutput(useApp.getState, p, "a");
    const [result] = useApp.getState().analysisResults;
    expect(result!.sources.map((x) => x.datasetId)).toEqual(["a", "b"]);
    useApp.getState().touchDataset("b");
    expect(useApp.getState().staleDatasets).toEqual([outputs()[0]!.id]);
  });

  it("redo restores the output and its result together", async () => {
    await commitTransformOutput(useApp.getState, { op: "transpose" }, "a");
    useApp.getState().undo();
    expect(outputs()).toHaveLength(0);
    useApp.getState().redo();
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });

  it("SIMS comparison: changing EITHER profile marks the output out of date", async () => {
    const p = { op: "simscompare" as const, species: ["B"], with: [{ id: "b", name: "b.dat" }] };
    for (const touched of ["a", "b"]) {
      useApp.setState({ analysisResults: [], staleDatasets: [], datasets: [sheet("a", [1, 2]), sheet("b", [3, 4])] });
      await commitTransformOutput(useApp.getState, p, "a");
      const out = outputs()[0]!.id;
      expect(useApp.getState().analysisResults[0]!.sources.map((x) => x.datasetId)).toEqual(["a", "b"]);
      useApp.getState().touchDataset(touched);
      expect(useApp.getState().staleDatasets).toEqual([out]);
    }
  });

  it("a declined review creates nothing", async () => {
    const out = await commitTransformOutput(useApp.getState, { op: "transpose" }, "a", () => Promise.resolve(false));
    expect(out).toBeNull();
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("refuses, creating nothing, when an input changed while the review was open", async () => {
    await expect(commitTransformOutput(useApp.getState, { op: "transpose" }, "a", async () => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? sheet("a", [9, 9]) : d)) }));
      return true;
    })).rejects.toThrow(/changed after this result was computed/);
    expect(outputs()).toHaveLength(0);
  });
});
