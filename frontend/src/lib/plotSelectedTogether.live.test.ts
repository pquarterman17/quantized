// Origin gap audit 2 #1 (LIVE in the audit: a source cell changed to 99, the
// overlay still showed 1). "Plot selected together" now lands a graph whose
// curves reference their sources, so a cell edit, a row mask, an added curve,
// Undo, and a .dwk round trip all keep it in step with the sources.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushLinkedCurves } from "../store/linkedCurvesSync";
import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";
import { addCurveFrom, plotSelectedTogether } from "./plotSelectedTogether";
import type { Dataset } from "./types";
import { parseWorkspace } from "./workspace";
import { serializeWorkspace } from "./workspaceSerialize";

vi.mock("../store/paramDialog", () => ({ askParams: vi.fn() }));
import { askParams } from "../store/paramDialog";

const plain = (id: string, name: string, time: number[], y: number[], extra: number[] = y): Dataset => ({
  id,
  name,
  data: { time, values: time.map((_, i) => [y[i], extra[i]]), labels: ["Y", "Z"], units: ["V", "A"], metadata: {} },
});

const a = plain("a", "Sample A", [1, 2, 3], [1, 2, 3]);
const b = plain("b", "Sample B", [5, 6], [50, 60], [7, 8]);

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
const col = (c: number) => graph().data.values.map((r) => r[c]);

beforeEach(() => {
  useApp.setState({ datasets: [a, b], selectedIds: [], history: [], future: [] });
  useToasts.setState({ toasts: [] });
});

describe("Plot selected together makes a LIVE graph", () => {
  it("references each source's curve and follows a cell edit and a row mask", async () => {
    await plotSelectedTogether(["a", "b"]);
    expect(graph().linkedCurves).toEqual([
      { datasetId: "a", xKey: null, yKey: 0, label: "Sample A", labelFrom: "name" },
      { datasetId: "b", xKey: null, yKey: 0, label: "Sample B", labelFrom: "name" },
    ]);
    expect(useApp.getState().activeId).toBe(graph().id);
    expect(col(0)).toEqual([1, 2, 3, NaN, NaN]);
    // Titled by the plotted quantity, not by the dataset names its curves carry.
    expect(useApp.getState().yAxisLabel).toBe("Y (V)");

    // The audit's repro: a source cell becomes 99 -> the graph shows 99.
    const edited = { ...a, data: { ...a.data, values: [[99, 1], [2, 2], [3, 3]] } };
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? edited : d)) }));
    flushLinkedCurves();
    expect(col(0)).toEqual([99, 2, 3, NaN, NaN]);

    // A masked source row drops out of the graph too.
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "b" ? { ...d, excludedRows: [1] } : d)) }));
    flushLinkedCurves();
    expect(col(1)).toEqual([NaN, NaN, NaN, 50, NaN]);
  });

  it("Add curve from… adds another dataset's X/Y to the graph; Undo takes it back", async () => {
    await plotSelectedTogether(["a", "b"]);
    vi.mocked(askParams)
      .mockResolvedValueOnce({ dataset: "Sample B" })
      .mockResolvedValueOnce({ x: "Y", y: "Z" });
    await addCurveFrom();
    expect(graph().linkedCurves?.[2]).toEqual({ datasetId: "b", xKey: 0, yKey: 1, label: "Sample B: Z", labelFrom: "nameCol" });
    // Its own block: x = b's Y column (50, 60), y = b's Z column (7, 8).
    expect(graph().data.time.slice(-2)).toEqual([50, 60]);
    expect(col(2).slice(-2)).toEqual([7, 8]);
    expect(graph().data.labels[2]).toBe("Sample B: Z");
    expect(useApp.getState().yAxisLabel).toBe("Y (V) / Z (A)");
    useApp.getState().undo();
    expect(graph().linkedCurves).toHaveLength(2);
    expect(graph().data.labels).toEqual(["Sample A", "Sample B"]);
  });

  it("Add curve from… on a plain multi-X sheet's graph keeps each drawn Y on its own X", async () => {
    // T1 (time), R1, T2 (Set As X), R2: R1 on T1, R2 on T2 (gap-2 #2).
    const sheet: Dataset = {
      id: "m", name: "multix",
      data: { time: [1, 2], values: [[10, 5, 100], [20, 3, 200]], labels: ["R1", "T2", "R2"], units: ["ohm", "K", "ohm"], metadata: {} },
      columnDesignations: { 1: "X" },
    };
    useApp.setState({ datasets: [a, b, sheet], activeId: "m", xKey: null, yKeys: null, hiddenChannels: [1], seriesLabels: {}, seriesStyles: {} });
    vi.mocked(askParams)
      .mockResolvedValueOnce({ dataset: "Sample A" })
      .mockResolvedValueOnce({ x: "(its own X)", y: "Y" });
    await addCurveFrom();
    expect(graph().linkedCurves).toEqual([
      { datasetId: "m", xKey: null, yKey: 0, label: "R1" },
      { datasetId: "m", xKey: 1, yKey: 2, label: "R2" },
      { datasetId: "a", xKey: null, yKey: 0, label: "Sample A: Y", labelFrom: "nameCol" },
    ]);
    expect(graph().data.time).toEqual([1, 2, 5, 3, 1, 2, 3]);
  });

  it("round-trips a .dwk and re-links to the live sources after load", async () => {
    await plotSelectedTogether(["a", "b"]);
    const text = serializeWorkspace(useApp.getState());
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const loaded = graph();
    expect(loaded.linkedCurves).toHaveLength(2);
    const edited = { ...a, data: { ...a.data, values: [[42, 1], [2, 2], [3, 3]] } };
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? edited : d)) }));
    flushLinkedCurves();
    await vi.waitFor(() => expect(col(0)[0]).toBe(42));
  });
});
