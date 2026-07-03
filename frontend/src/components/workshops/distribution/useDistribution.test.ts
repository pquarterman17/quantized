import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsDescriptive, statsHistogram, statsShapiro } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDistribution } from "./useDistribution";

vi.mock("../../../lib/api", () => ({
  statsHistogram: vi.fn(),
  statsDescriptive: vi.fn(),
  statsShapiro: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[10], [20], [30], [40], [50], [60]],
  labels: ["v"],
  units: [""],
  metadata: { x_column_name: "T" },
};

const HIST = { counts: [2, 2, 2], centers: [15, 35, 55], edges: [10, 30, 50, 70], n_bins: 3, n: 6 };
const DESC = { N: 6, mean: 35, median: 35, std: 18.7, min: 10, max: 60 };
const NORM = { W: 0.95, p: 0.7, N: 6 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue(HIST);
  vi.mocked(statsDescriptive).mockResolvedValue(DESC);
  vi.mocked(statsShapiro).mockResolvedValue(NORM);
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
});

describe("useDistribution", () => {
  it("profiles the default column: histogram + stats + normality", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    expect(statsHistogram).toHaveBeenCalledWith([10, 20, 30, 40, 50, 60]);
    expect(result.current.hist!.counts).toEqual([2, 2, 2]);
    expect(result.current.desc).toEqual(DESC);
    expect(result.current.norm).toEqual({ W: 0.95, p: 0.7, N: 6 });
    expect(result.current.label).toBe("v");
  });

  it("honors row exclusion (#50): excluded rows drop from the profiled column", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0, 1] }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(statsHistogram).toHaveBeenCalled());
    expect(statsHistogram).toHaveBeenCalledWith([30, 40, 50, 60]);
    expect(result.current).toBeTruthy();
  });

  it("keeps histogram + stats when the normality test fails", async () => {
    vi.mocked(statsShapiro).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    expect(result.current.norm).toBeNull();
    expect(result.current.normNote).toBe("normality test unavailable");
    expect(result.current.desc).toEqual(DESC); // survived
  });

  it("surfaces a bin error when the column is too sparse", async () => {
    vi.mocked(statsHistogram).mockRejectedValue(new Error("needs 2 finite"));
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.hist).toBeNull();
    expect(result.current.error).toContain("too few");
  });

  it("re-profiles when the selected column changes (x here)", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.setCol(-1));
    await waitFor(() => expect(statsHistogram).toHaveBeenLastCalledWith([0, 1, 2, 3, 4, 5]));
    expect(result.current.label).toBe("T");
  });
});
