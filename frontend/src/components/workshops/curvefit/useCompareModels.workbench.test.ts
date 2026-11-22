// Compare models on the workbench shell's manual mode (lane WB4): still the
// Compare button only; the table is out of date when the picked models, the
// custom equations behind them or the data / channels it ran with change; an
// answer for inputs changed in flight is dropped (forced with a held request).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareModels, type CompareResult } from "../../../lib/api/fitStats";
import type { CustomFitModel } from "../../../lib/fitmodels";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCompareModels } from "./useCompareModels";

vi.mock("../../../lib/api/fitStats", () => ({ compareModels: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[1, 10, 5], [2, 20, 6], [3, 30, 7], [4, 40, 8]], labels: ["x", "y", "y2"], units: ["", "", ""], metadata: {},
};
const CUSTOM: CustomFitModel = { version: 2, name: "sq", equation: "y = a*x^2", params: ["a"], guesses: [1], lower: [null], upper: [null] };
const RESULT: CompareResult = { n: 4, reference: "Linear", results: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(compareModels).mockResolvedValue(RESULT);
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: 0, yKeys: [1], seriesOrder: null });
});

describe("useCompareModels freshness", () => {
  it("characterization: nothing runs until compare(); a failed run clears the table", async () => {
    const { result } = renderHook(() => useCompareModels(["Linear", "Quadratic"], []));
    act(() => result.current.remove("Quadratic"));
    act(() => result.current.add("Quadratic"));
    await act(async () => {});
    expect(compareModels).not.toHaveBeenCalled();
    await act(() => result.current.compare());
    expect(result.current.result).toEqual(RESULT);
    expect(result.current.stale).toBe(false);
    vi.mocked(compareModels).mockRejectedValueOnce(new Error("boom"));
    await act(() => result.current.compare());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBe("boom");
    expect(result.current.refusal).toBe(false);
  });

  it("is out of date once the picked models, the channel or the rows change", async () => {
    const { result } = renderHook(() => useCompareModels(["Linear", "Quadratic"], [CUSTOM]));
    await act(() => result.current.compare());
    act(() => result.current.add("custom:sq"));
    expect(result.current.stale).toBe(true);
    expect(result.current.result).toEqual(RESULT); // still shown, marked
    act(() => result.current.remove("custom:sq"));
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState({ yKeys: [2] }));
    expect(result.current.stale).toBe(true);
    act(() => useApp.setState({ yKeys: [1] }));
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
    await act(() => result.current.compare());
    expect(result.current.stale).toBe(false);
  });

  it("forced race: an answer for picks changed in flight is dropped", async () => {
    let land!: (r: CompareResult) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(compareModels).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r; }); });
    const { result } = renderHook(() => useCompareModels(["Linear", "Quadratic"], []));
    let p!: Promise<void>;
    act(() => { p = result.current.compare(); });
    await started;
    expect(result.current.busy).toBe(true);
    act(() => result.current.remove("Quadratic"));
    land(RESULT);
    await act(async () => { await p; });
    expect(result.current.busy).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it("a dataset that cannot be compared is a refusal", async () => {
    useApp.setState({ yKeys: [0] }); // the X column itself
    const { result } = renderHook(() => useCompareModels(["Linear", "Quadratic"], []));
    await act(() => result.current.compare());
    expect(result.current.error).toBeTruthy();
    expect(result.current.refusal).toBe(true);
    expect(compareModels).not.toHaveBeenCalled();
  });
});
