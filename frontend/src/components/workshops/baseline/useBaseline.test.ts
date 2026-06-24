import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  baselineALS,
  baselineEstimate,
  baselineModPoly,
  baselineRollingBall,
} from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useBaseline } from "./useBaseline";

vi.mock("../../../lib/api", () => ({
  baselineALS: vi.fn(),
  baselineEstimate: vi.fn(),
  baselineModPoly: vi.fn(),
  baselineRollingBall: vi.fn(),
}));

const raw: DataStruct = {
  time: [1, 2, 3, 4],
  values: [[10], [12], [11], [13]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: raw }],
    activeId: "d1",
    status: "",
    baselineOverlay: null,
  });
});

describe("useBaseline", () => {
  it("estimates with ALS by default and overlays the baseline", async () => {
    vi.mocked(baselineALS).mockResolvedValue({ baseline: [1, 1, 1, 1] });
    const { result } = renderHook(() => useBaseline());

    await act(async () => {
      await result.current.compute();
    });

    expect(baselineALS).toHaveBeenCalledWith({ y: [10, 12, 11, 13], lam: 1e6, p: 0.01 });
    expect(result.current.baseline).toEqual([1, 1, 1, 1]);
    const ov = useApp.getState().baselineOverlay;
    expect(ov).toEqual({ datasetId: "d1", y: [1, 1, 1, 1] });
  });

  it("dispatches to the selected method with its params", async () => {
    vi.mocked(baselineRollingBall).mockResolvedValue({ baseline: [0, 0, 0, 0], info: {} });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("rollingball"));
    act(() => result.current.setParams({ radius: 40 }));
    await act(async () => {
      await result.current.compute();
    });

    expect(baselineRollingBall).toHaveBeenCalledWith({ y: [10, 12, 11, 13], radius: 40 });
    expect(baselineALS).not.toHaveBeenCalled();
  });

  it("SNIP passes x as well as y", async () => {
    vi.mocked(baselineEstimate).mockResolvedValue({ baseline: [2, 2, 2, 2] });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("snip"));
    await act(async () => {
      await result.current.compute();
    });

    expect(baselineEstimate).toHaveBeenCalledWith({
      x: [1, 2, 3, 4],
      y: [10, 12, 11, 13],
      method: "snip",
    });
  });

  it("subtract writes a new background-subtracted dataset", async () => {
    vi.mocked(baselineModPoly).mockResolvedValue({ baseline: [1, 2, 1, 3], info: {} });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("modpoly"));
    await act(async () => {
      await result.current.compute();
    });
    act(() => result.current.subtract());

    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    const sub = ds[1];
    expect(sub.name).toBe("scan (bg-sub)");
    expect(sub.data.values).toEqual([[9], [10], [10], [10]]); // y - baseline
    expect(sub.data.metadata.baseline_subtracted).toBe("modpoly");
  });

  it("subtract is a no-op before an estimate exists", () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.subtract());
    expect(useApp.getState().datasets).toHaveLength(1); // nothing added
  });

  it("surfaces an estimation error and sets no overlay", async () => {
    vi.mocked(baselineALS).mockRejectedValue(new Error("singular matrix"));
    const { result } = renderHook(() => useBaseline());

    await act(async () => {
      await result.current.compute();
    });

    expect(result.current.error).toContain("singular");
    expect(useApp.getState().baselineOverlay).toBeNull();
  });
});
