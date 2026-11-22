// ROI cuts Box "Stats" readout, out of date (lane WB7). The numeric readout is
// stamped with the rows and the box it was measured for: a moved box or edited
// rows mark it out of date (values withheld); leaving the dataset drops it
// (also on a return to one whose sector settings are banked); an answer for a
// dataset left or a box moved in flight never lands as current.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxStats } from "../../../lib/api/rsm";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useRoiCuts } from "./useRoiCuts";

vi.mock("../../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(), rsmBoxStats: vi.fn(), rsmSector: vi.fn(), rsmChiProfile: vi.fn(),
}));

const MAP: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[60, 30, 100], [61, 30, 200], [60, 31, 150], [61, 31, 300]],
  labels: ["2Theta", "Omega", "Intensity"], units: ["deg", "deg", "cps"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};
const STATS = {
  n_points: 4, integrated_intensity: 42, mean_intensity: 10.5, max_intensity: 20, peak_x: 1, peak_y: 2,
  centroid_x: 1.1, centroid_y: 2.2, x_min: 0, x_max: 10, y_min: 0, y_max: 10, space: "angular", angle: 0, wrap: null,
};
const BOX = { space: "angular" as const, x0: 0, x1: 10, y0: 0, y1: 10 };

function setup(): void {
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: MAP }, { id: "b", name: "b", data: { ...MAP } }],
    activeId: "a", mapRoi: BOX, mapRuler: null, savedRois: [], selectedIds: [], mapSector: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rsmBoxStats).mockResolvedValue(STATS);
  setup();
});

async function measured() {
  const hook = renderHook(() => useRoiCuts());
  await act(async () => { await hook.result.current.runStats(); });
  return hook;
}

describe("ROI cuts box statistics out of date", () => {
  it("characterization: a fresh readout is current", async () => {
    const { result } = await measured();
    expect(result.current.boxStats).toEqual(STATS);
    expect(result.current.statsStale).toBe(false);
  });

  it("a moved box marks the readout out of date; measuring again clears it", async () => {
    const { result } = await measured();
    act(() => result.current.setBoxX1(5));
    expect(result.current.boxStats).not.toBeNull(); // kept, marked (the card withholds the values)
    expect(result.current.statsStale).toBe(true); // fail-before: no marker existed
    await act(async () => { await result.current.runStats(); });
    expect(result.current.statsStale).toBe(false);
  });

  it("edited rows mark the readout out of date", async () => {
    const { result } = await measured();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, excludedRows: [0] } : d)) })));
    expect(result.current.statsStale).toBe(true);
  });

  it("switching datasets and back never shows the other dataset's numbers", async () => {
    const { result } = await measured();
    act(() => useApp.setState({ activeId: "b" }));
    expect(result.current.boxStats).toBeNull();
    act(() => useApp.setState({ activeId: "a" }));
    act(() => useApp.setState({ activeId: "b" })); // b's sector settings are now banked: a return visit
    expect(result.current.boxStats).toBeNull(); // fail-before: a return visit skipped the reset
  });

  it("forced race: an answer for a dataset the user left lands nowhere", async () => {
    let land!: (r: typeof STATS) => void;
    vi.mocked(rsmBoxStats).mockImplementationOnce(() => new Promise((r) => { land = r as never; }));
    const { result } = renderHook(() => useRoiCuts());
    let pending!: Promise<void>;
    act(() => { pending = result.current.runStats(); });
    act(() => useApp.setState({ activeId: "b" }));
    await act(async () => { land(STATS); await pending; });
    expect(result.current.boxStats).toBeNull(); // fail-before: a's numbers under b
    expect(result.current.statsBusy).toBe(false);
  });

  it("forced race: a box moved in flight leaves the landed readout out of date", async () => {
    let land!: (r: typeof STATS) => void;
    vi.mocked(rsmBoxStats).mockImplementationOnce(() => new Promise((r) => { land = r as never; }));
    const { result } = renderHook(() => useRoiCuts());
    let pending!: Promise<void>;
    act(() => { pending = result.current.runStats(); });
    act(() => result.current.setBoxX1(5));
    await act(async () => { land(STATS); await pending; });
    expect(result.current.boxStats).not.toBeNull();
    expect(result.current.statsStale).toBe(true); // fail-before: current
  });
});
