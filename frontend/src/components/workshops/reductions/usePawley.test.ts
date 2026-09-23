import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pawleyRefine } from "../../../lib/api/reductions";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { usePawley } from "./usePawley";

vi.mock("../../../lib/api/reductions", () => ({
  pawleyRefine: vi.fn(),
}));

const scan: DataStruct = {
  time: [20, 30, 40, 50],
  values: [[100, 9], [200, 8], [300, 7], [400, 6]],
  labels: ["Intensity", "Other"],
  units: ["cps", "cps"],
  metadata: {},
};

const result: PawleyResult = {
  cell: [5.42, 5.42, 5.42, 90, 90, 90],
  cell_initial: [5.43, 5.43, 5.43, 90, 90, 90],
  scale: null,
  peaks: [{ hkl: [1, 0, 0], two_theta: 20, d: 2, multiplicity: 6, intensity: 12 }],
  background: [10, 10, 10, 10],
  model: [90, 190, 290, 390],
  residual: [10, 10, 10, 10],
  rwp: 0.05,
  n_peaks: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "powder.xrdml", data: scan }],
    activeId: "d1",
    status: "",
  });
});

describe("usePawley", () => {
  it("refines the selected intensity channel against the active 2theta axis", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue(result);
    const { result: hook } = renderHook(() => usePawley());
    act(() => {
      hook.current.setCol(1);
      hook.current.setA(4.1);
      hook.current.setB(4.2);
      hook.current.setC(4.3);
      hook.current.setSymmetry("I");
    });
    await act(async () => {
      await hook.current.compute();
    });
    expect(pawleyRefine).toHaveBeenCalledWith(expect.objectContaining({
      two_theta: [20, 30, 40, 50],
      intensity: [9, 8, 7, 6],
      a: 4.1,
      b: 4.2,
      c: 4.3,
      symmetry: "I",
    }));
    expect(hook.current.result?.cell[0]).toBe(5.42);
  });

  it("drops non-finite rows before calling the float-only API", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue({ ...result, model: [90, 290, 390], residual: [10, 10, 10], background: [10, 10, 10] });
    useApp.setState({
      datasets: [{
        id: "d1", name: "gappy.xrdml",
        data: { ...scan, values: [[100, 9], [Number.NaN, 8], [300, 7], [400, 6]] },
      }],
      activeId: "d1",
    });
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    expect(pawleyRefine).toHaveBeenCalledWith(expect.objectContaining({
      two_theta: [20, 40, 50],
      intensity: [100, 300, 400],
    }));
  });

  it("adds observed, model, and residual using the exact refined rows", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue(result);
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    // Change the live dataset after refinement; derived output must still use
    // the rows that produced the result, not a later preview/reimport state.
    act(() => {
      useApp.setState({
        datasets: [{ id: "d1", name: "powder.xrdml", data: { ...scan, time: [1, 2, 3, 4] } }],
      });
      hook.current.toLibrary();
    });
    const added = useApp.getState().datasets[1];
    expect(added.data.time).toEqual([20, 30, 40, 50]);
    expect(added.data.values).toEqual([
      [100, 90, 10],
      [200, 190, 10],
      [300, 290, 10],
      [400, 390, 10],
    ]);
  });

  it("surfaces backend validation errors", async () => {
    vi.mocked(pawleyRefine).mockRejectedValue(new Error("no reflections in range"));
    const { result: hook } = renderHook(() => usePawley());
    await act(async () => {
      await hook.current.compute();
    });
    expect(hook.current.result).toBeNull();
    expect(hook.current.error).toBe("no reflections in range");
  });
});
