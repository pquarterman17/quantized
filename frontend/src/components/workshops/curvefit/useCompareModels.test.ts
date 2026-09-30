// Curve Fit "Compare models" hook: every picked model (registry names and
// saved custom equations) is fitted to the SAME selection the Fit button
// uses, and the comparison lands as state.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareModels, type CompareResult } from "../../../lib/api/fitStats";
import type { CustomFitModel } from "../../../lib/fitmodels";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCompareModels } from "./useCompareModels";

vi.mock("../../../lib/api/fitStats", () => ({ compareModels: vi.fn() }));

// col0 = x, col1 = y with a gap row (NaN) that must be dropped.
const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1, 10], [2, Number.NaN], [3, 30], [4, 40]],
  labels: ["x", "y"],
  units: ["", ""],
  metadata: {},
};

const CUSTOM: CustomFitModel = {
  version: 2,
  name: "sq",
  equation: "y = a*x^2",
  params: ["a"],
  guesses: [1],
  lower: [null],
  upper: [null],
};

const RESULT: CompareResult = { n: 3, reference: "Linear", results: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(compareModels).mockResolvedValue(RESULT);
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: 0,
    yKeys: [1],
    seriesOrder: null,
  });
});

describe("useCompareModels", () => {
  it("needs two picked models before it can compare", () => {
    const { result } = renderHook(() => useCompareModels(["Linear"], []));
    expect(result.current.canCompare).toBe(false);
    act(() => result.current.add("Quadratic"));
    expect(result.current.picked).toEqual(["Linear", "Quadratic"]);
    expect(result.current.canCompare).toBe(true);
    act(() => result.current.remove("Linear"));
    expect(result.current.canCompare).toBe(false);
  });

  it("never picks the blank custom entry or a duplicate", () => {
    const { result } = renderHook(() => useCompareModels(["Linear", "custom:"], []));
    act(() => {
      result.current.add("custom:");
      result.current.add("Linear");
    });
    expect(result.current.picked).toEqual(["Linear"]);
  });

  it("posts the plotted X / primary Y without gap rows, splitting registry models from equations", async () => {
    const { result } = renderHook(() => useCompareModels(["Linear"], [CUSTOM]));
    act(() => result.current.add("custom:sq"));
    await act(() => result.current.compare());
    await waitFor(() => expect(result.current.result).toEqual(RESULT));
    expect(vi.mocked(compareModels).mock.calls[0]![0]).toEqual({
      x: [1, 3, 4],
      y: [10, 30, 40],
      models: ["Linear"],
      equations: [{ name: "sq", equation: "y = a*x^2", guesses: [1] }],
    });
  });

  it("surfaces a failed comparison and clears the table", async () => {
    vi.mocked(compareModels).mockRejectedValue(new Error("need at least two models"));
    const { result } = renderHook(() => useCompareModels(["Linear", "Quadratic"], []));
    await act(() => result.current.compare());
    await waitFor(() => expect(result.current.error).toBe("need at least two models"));
    expect(result.current.result).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});
