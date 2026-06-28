import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "../../../lib/download";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWaterfall } from "./useWaterfall";

vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const mk = (rChannelVals: number[]): DataStruct => ({
  time: [10, 20, 30],
  values: rChannelVals.map((v) => [v]),
  labels: ["R"],
  units: ["cts"],
  metadata: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [
      { id: "d1", name: "5K.dat", data: mk([1, 2, 3]) },
      { id: "d2", name: "10K.dat", data: mk([4, 5, 6]) },
      { id: "d3", name: "15K.dat", data: mk([7, 8, 9]) },
    ],
    activeId: "d1",
    selectedIds: ["d1", "d2", "d3"],
    status: "",
  });
});

describe("useWaterfall", () => {
  it("defaults the included set to the multi-selection and picks a shared channel", () => {
    const { result } = renderHook(() => useWaterfall());
    expect(result.current.count).toBe(3);
    expect(result.current.channels).toEqual(["R"]);
    expect(result.current.channel).toBe("R");
  });

  it("excludes a dataset when unticked", () => {
    const { result } = renderHook(() => useWaterfall());
    act(() => result.current.setIncluded("d3", false));
    expect(result.current.count).toBe(2);
    // Two traces (d1, d2), aligned on the shared x grid.
    expect(result.current.aligned.ys).toHaveLength(2);
  });

  it("auto-spacing offsets each trace; aligned y reflects the stack", () => {
    const { result } = renderHook(() => useWaterfall());
    // ranges are all 2 (3−1, 6−4, 8... wait 9−7=2) → spacing 0.8×2 = 1.6
    expect(result.current.spacing).toBeCloseTo(1.6);
    // d1 (k=0) unshifted at x=10 → 1; d2 (k=1) → 4 + 1.6 = 5.6
    expect(result.current.aligned.ys[0][0]).toBeCloseTo(1);
    expect(result.current.aligned.ys[1][0]).toBeCloseTo(5.6);
  });

  it("manual spacing overrides auto", () => {
    const { result } = renderHook(() => useWaterfall());
    act(() => {
      result.current.setAutoSpace(false);
      result.current.setManualSpacing(100);
    });
    expect(result.current.spacing).toBe(100);
    expect(result.current.aligned.ys[1][0]).toBeCloseTo(104); // 4 + 100
  });

  it("export writes a CSV blob (with and without offset)", () => {
    const { result } = renderHook(() => useWaterfall());
    act(() => result.current.exportCSV(true));
    act(() => result.current.exportCSV(false));
    expect(saveBlob).toHaveBeenCalledTimes(2);
    const [, withName] = vi.mocked(saveBlob).mock.calls[0];
    const [, rawName] = vi.mocked(saveBlob).mock.calls[1];
    expect(withName).toContain("offset");
    expect(rawName).toContain("raw");
  });
});
