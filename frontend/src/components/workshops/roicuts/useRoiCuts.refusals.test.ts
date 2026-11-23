// ROI cuts fail-closed acceptance (OPEN_ITEMS row 14): no box, a non-finite
// bound, no dataset and a backend refusal each end in a user-facing message and
// no request / no worksheet.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats, rsmChiProfile, rsmSector } from "../../../lib/api/rsm";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { NO_BOX_REASON } from "./cutGuards";
import { useRoiCuts } from "./useRoiCuts";

vi.mock("../../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(),
  rsmBoxStats: vi.fn(),
  rsmSector: vi.fn(),
  rsmChiProfile: vi.fn(),
}));

const Q_DS: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [60, 30, 100, 0.5, 4.0],
    [61, 30, 200, 0.45, 3.9],
    [60, 31, 150, 0.4, 4.1],
    [61, 31, 300, 0.42, 3.8],
  ],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    mapRoi: null, mapRuler: null, savedRois: [], selectedIds: [], mapSector: {}, status: "",
    datasets: [{ id: "d1", name: "d1.xrdml", data: Q_DS }], activeId: "d1",
  });
});

describe("ROI cuts refusals", () => {
  it("missing input: Run with no box says so and sends nothing", () => {
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.runBox());
    expect(useApp.getState().status).toBe(NO_BOX_REASON);
    expect(rsmBoxCut).not.toHaveBeenCalled();
  });

  it("missing input: Stats with no box reports it on the stats error line", async () => {
    const { result } = renderHook(() => useRoiCuts());
    await act(async () => { await result.current.runStats(); });
    expect(result.current.statsError).toBe(NO_BOX_REASON);
    expect(rsmBoxStats).not.toHaveBeenCalled();
  });

  it("missing input: no active dataset says to select one", () => {
    useApp.setState({ datasets: [], activeId: null });
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.runSector());
    expect(useApp.getState().status).toMatch(/select a 2-D map dataset/i);
    expect(rsmSector).not.toHaveBeenCalled();
  });

  it("non-finite: a NaN box bound is refused, not sent as null", async () => {
    act(() => useApp.getState().setMapRoi({ space: "angular", x0: Number.NaN, x1: 10, y0: 0, y1: 10 }));
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.runBox());
    expect(useApp.getState().status).toMatch(/not a finite number.*Nothing was cut/);
    expect(rsmBoxCut).not.toHaveBeenCalled();
    await act(async () => { await result.current.runStats(); });
    expect(result.current.statsError).toMatch(/not a finite number/);
    expect(rsmBoxStats).not.toHaveBeenCalled();
  });

  it("non-finite: a NaN sector bound is refused on both profiles", () => {
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.setSecMax(Number.NaN));
    act(() => result.current.runSector());
    expect(useApp.getState().status).toMatch(/sector.*not a finite number/i);
    act(() => result.current.runChi());
    expect(rsmSector).not.toHaveBeenCalled();
    expect(rsmChiProfile).not.toHaveBeenCalled();
  });

  it("too few rows / empty data: a backend 'selects no data' refusal reaches the status and adds no worksheet", async () => {
    vi.mocked(rsmBoxCut).mockRejectedValue(new Error("box selects no data"));
    act(() => useApp.getState().setMapRoi({ space: "angular", x0: 0, x1: 1, y0: 0, y1: 1 }));
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.runBox());
    await flush();
    expect(useApp.getState().status).toBe("cut failed: box selects no data");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});
