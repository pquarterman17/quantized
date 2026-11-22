// Tabulate "Export → dataset" on the shared commit contract (lane RL2).
// Fail-before: clicking Export twice wrote two identical worksheets, with no
// Library result and no stale mark when the source changed.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useTabulate } from "./useTabulate";

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [[0, 10], [0, 12], [0, 14], [0, 16], [0, 18], [0, 20], [1, 30], [1, 32], [1, 34], [1, 36], [1, 38], [1, 40]],
  labels: ["grp", "val"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

describe("Tabulate export commits through the shared contract", () => {
  it("a repeat Export on the same setup creates no duplicate", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.exportDataset());
    expect(outputs()).toHaveLength(1);
    act(() => useApp.getState().setActive("d1"));
    expect(result.current.exportDisabledReason).toContain(`Already added as “${outputs()[0].name}”`);
    act(() => result.current.exportDataset());
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0].producer.label).toBe("Tabulate");
  });

  it("is one undo step, and Undo re-enables Export", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.exportDataset());
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    act(() => useApp.getState().setActive("d1"));
    expect(result.current.exportDisabledReason).toBeNull();
    act(() => result.current.exportDataset());
    expect(outputs()).toHaveLength(1);
  });

  it("a changed stat set is a new computation and exports normally", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.exportDataset());
    act(() => useApp.getState().setActive("d1"));
    act(() => result.current.toggleStat("sum"));
    act(() => result.current.exportDataset());
    expect(outputs()).toHaveLength(2);
  });

  it("marks the export stale when its source changes", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.exportDataset());
    const outputId = outputs()[0].id;
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "d1" ? { ...d, data: { ...d.data, time: [...d.data.time.slice(0, 11), 99] } } : d) }));
      useApp.getState().touchDataset("d1");
    });
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
  });
});
