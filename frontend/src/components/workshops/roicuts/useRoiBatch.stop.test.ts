// ROI batch Stop + determinate progress (OPEN_ITEMS row 15). The race is
// forced, not repeated: the first dataset's cut request is held on a deferred,
// Stop is pressed while it is in flight, then the request is released. State is
// awaited (the rendered progress / the datasets that landed), never a mock call.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats, type BoxStats } from "../../../lib/api/rsm";
import { plotSelectedTogether } from "../../../lib/plotSelectedTogether";
import type { RoiRect } from "../../../lib/roi";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useRoiBatch } from "./useRoiBatch";

vi.mock("../../../lib/api/rsm", () => ({ rsmBoxCut: vi.fn(), rsmBoxStats: vi.fn() }));
vi.mock("../../../lib/plotSelectedTogether", () => ({ plotSelectedTogether: vi.fn() }));

const map = (): DataStruct => ({
  time: [0, 1, 2, 3],
  values: [[60, 30, 100], [61, 30, 200], [60, 31, 150], [61, 31, 300]],
  labels: ["2Theta", "Omega", "Intensity"],
  units: ["deg", "deg", "cps"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
});
const CUT: DataStruct = {
  time: [0, 1],
  values: [[0.5, 10], [0.6, 12]],
  labels: ["Intensity", "N points"],
  units: ["cps", ""],
  metadata: { cut_label: "box cut" },
};
const STATS = {
  n_points: 4, integrated_intensity: 42, mean_intensity: 10.5, max_intensity: 20, peak_x: 1, peak_y: 2,
  centroid_x: 1.1, centroid_y: 2.2, x_min: 0, x_max: 10, y_min: 0, y_max: 10, space: "angular", angle: 0, wrap: null,
} as BoxStats;
const RECT: RoiRect = { space: "angular", x0: 0, x1: 10, y0: 0, y1: 10 };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: ["a", "b", "c"].map((id) => ({ id, name: id, data: map() })),
    selectedIds: ["a", "b", "c"],
    activeId: "a",
    mapRoi: null,
    savedRois: [],
  });
  vi.mocked(rsmBoxStats).mockResolvedValue(STATS);
  vi.mocked(plotSelectedTogether).mockResolvedValue(undefined);
});

describe("useRoiBatch: Stop and progress", () => {
  it("shows done/total while a dataset is in flight, and Stop skips the rest and lands no aggregate", async () => {
    const held = deferred<DataStruct>();
    vi.mocked(rsmBoxCut).mockReturnValueOnce(held.promise).mockResolvedValue(CUT);
    const { result } = renderHook(() => useRoiBatch());

    let run!: Promise<void>;
    act(() => { run = result.current.applyToSelected(RECT); });
    // Determinate progress is state the UI reads: the first of three is running.
    await waitFor(() => expect(result.current.progress).toEqual({ done: 0, total: 3, current: "a" }));

    act(() => result.current.stop()); // pressed while "a" is mid-request
    await act(async () => {
      held.resolve(CUT);
      await run;
    });

    // The in-flight dataset finished whole; the two not started never ran.
    const names = useApp.getState().datasets.map((d) => d.name);
    expect(names.filter((n) => n.endsWith("box cut"))).toEqual(["a: box cut"]);
    expect(rsmBoxCut).toHaveBeenCalledTimes(1);
    expect(result.current.outcome?.stopped).toBe(2);
    expect(result.current.outcome?.appliedCount).toBe(1);
    // No aggregate over part of the selection: no summary dataset, no overlay.
    expect(result.current.outcome?.summaryLanded).toBe(false);
    expect(result.current.summaryRows).toEqual([]);
    expect(names.some((n) => n.toLowerCase().includes("summary"))).toBe(false);
    expect(plotSelectedTogether).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(useApp.getState().status).toMatch(/stopped: applied to 1 of 3/);
  });

  it("a Stop pressed while idle does not leak into the next run", async () => {
    vi.mocked(rsmBoxCut).mockResolvedValue(CUT);
    const { result } = renderHook(() => useRoiBatch());
    act(() => result.current.stop());
    await act(async () => { await result.current.applyToSelected(RECT); });
    expect(result.current.outcome?.stopped).toBe(0);
    expect(result.current.outcome?.appliedCount).toBe(3);
  });
});
