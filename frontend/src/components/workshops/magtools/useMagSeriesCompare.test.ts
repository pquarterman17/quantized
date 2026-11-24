import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { magneticSeriesComparePlan } from "../../../lib/api/magnetic";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMagSeriesCompare } from "./useMagSeriesCompare";

vi.mock("../../../lib/api/magnetic", () => ({ magneticSeriesComparePlan: vi.fn() }));

const realResolve = useApp.getState().resolveDataset;

function loop(id: string, xUnit: string, yUnit: string): Dataset {
  return {
    id, name: `${id}.dat`,
    data: {
      time: [-1, 0, 1], values: [[-5], [0], [5]], labels: ["Moment"], units: [yUnit],
      metadata: { x_column_name: "Magnetic field", x_column_unit: xUnit },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [loop("a", "Oe", "emu"), loop("b", "T", "emu")], activeId: "a", selectedIds: ["a", "b"],
    xKey: null, yKeys: null, seriesOrder: null, resolveDataset: realResolve, status: "",
  });
  vi.mocked(magneticSeriesComparePlan).mockResolvedValue({
    axis: "field", x_unit: "Oe", y_unit: "emu",
    series: [{ label: "a.dat", x_factor: 1, y_factor: 1 }, { label: "b.dat", x_factor: 1e4, y_factor: 1 }],
  });
});

describe("useMagSeriesCompare", () => {
  it("overlays the selected worksheets in the active worksheet's units and records the plan", async () => {
    const { result } = renderHook(() => useMagSeriesCompare());
    expect(result.current.problem).toBeNull();
    await act(async () => { await result.current.compare(); });
    expect(magneticSeriesComparePlan).toHaveBeenCalledWith({
      axis: "field",
      series: [{ label: "a.dat", x_unit: "Oe", y_unit: "emu" }, { label: "b.dat", x_unit: "T", y_unit: "emu" }],
    });
    const out = useApp.getState().datasets[2]!;
    expect(out.data.time).toEqual([-1, 0, 1]);
    expect(out.data.values[0]).toEqual([-5, -1e4, -5]);
    expect(out.columnDesignations).toEqual({ 0: "Y", 1: "X", 2: "Y" });
    expect(result.current.shown?.error).toBeNull();
  });

  it("is blocked until two worksheets including the active one are selected", () => {
    useApp.setState({ selectedIds: ["a"] });
    expect(renderHook(() => useMagSeriesCompare()).result.current.problem).toMatch(/at least two/);
    useApp.setState({ selectedIds: ["b"] });
    expect(renderHook(() => useMagSeriesCompare()).result.current.problem).toMatch(/active worksheet must be one/);
  });

  it("surfaces the backend refusal (mixed bases) and adds nothing", async () => {
    vi.mocked(magneticSeriesComparePlan).mockRejectedValue(new Error("the series are not on one basis"));
    const { result } = renderHook(() => useMagSeriesCompare());
    await act(async () => { await result.current.compare(); });
    expect(result.current.shown?.error).toMatch(/not on one basis/);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("refuses when a worksheet changes while the plan is in flight", async () => {
    vi.mocked(magneticSeriesComparePlan).mockImplementation(async () => {
      useApp.setState({ datasets: [loop("a", "Oe", "emu"), loop("b", "T", "emu")] });
      return { axis: "field", x_unit: "Oe", y_unit: "emu", series: [{ label: "", x_factor: 1, y_factor: 1 }, { label: "", x_factor: 1, y_factor: 1 }] };
    });
    const { result } = renderHook(() => useMagSeriesCompare());
    await act(async () => { await result.current.compare(); });
    expect(result.current.shown?.error).toMatch(/changed during the comparison/);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("refuses mixed field and temperature axes before calling the backend", async () => {
    const t = loop("b", "K", "emu");
    t.data.metadata = { x_column_name: "Temperature", x_column_unit: "K" };
    useApp.setState({ datasets: [loop("a", "Oe", "emu"), t] });
    const { result } = renderHook(() => useMagSeriesCompare());
    await act(async () => { await result.current.compare(); });
    expect(result.current.shown?.error).toMatch(/mix field and temperature/);
    expect(magneticSeriesComparePlan).not.toHaveBeenCalled();
  });
});
