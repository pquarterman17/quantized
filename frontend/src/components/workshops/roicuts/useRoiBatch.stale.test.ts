// ROI batch summary, out of date (lane WB7). The summary rows (preview table +
// Export CSV) are stamped with the box they were measured for and the data of
// the datasets that ran. A moved box or edited rows mark them out of date and
// withhold the export; the cuts and summary dataset that already landed are
// receipts and stay. Apply to selected again clears the mark.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats } from "../../../lib/api/rsm";
import type { RoiRect } from "../../../lib/roi";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useRoiBatch } from "./useRoiBatch";

const { saveBlobMock } = vi.hoisted(() => ({ saveBlobMock: vi.fn() }));
vi.mock("../../../lib/api/rsm", () => ({ rsmBoxCut: vi.fn(), rsmBoxStats: vi.fn() }));
vi.mock("../../../lib/plotSelectedTogether", () => ({ plotSelectedTogether: vi.fn() }));
vi.mock("../../../lib/download", () => ({ saveBlob: saveBlobMock }));

const MAP = (): DataStruct => ({
  time: [0, 1, 2, 3],
  values: [[60, 30, 100], [61, 30, 200], [60, 31, 150], [61, 31, 300]],
  labels: ["2Theta", "Omega", "Intensity"], units: ["deg", "deg", "cps"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
});
const CUT: DataStruct = {
  time: [0, 1], values: [[0.5, 10], [0.6, 12]], labels: ["Intensity", "N points"], units: ["cps", ""], metadata: {},
};
const STATS = {
  n_points: 4, integrated_intensity: 42, mean_intensity: 10.5, max_intensity: 20, peak_x: 1, peak_y: 2,
  centroid_x: 1.1, centroid_y: 2.2, x_min: 0, x_max: 10, y_min: 0, y_max: 10, space: "angular", angle: 0, wrap: null,
};
const RECT: RoiRect = { space: "angular", x0: 0, x1: 10, y0: 0, y1: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rsmBoxCut).mockResolvedValue(CUT);
  vi.mocked(rsmBoxStats).mockResolvedValue(STATS);
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: MAP() }, { id: "b", name: "b", data: MAP() }],
    selectedIds: ["a", "b"], activeId: "a", mapRuler: null, savedRois: [],
  });
  useApp.getState().setMapRoi(RECT);
});

async function ran() {
  const hook = renderHook(() => useRoiBatch());
  await act(async () => { await hook.result.current.applyToSelected(RECT); });
  return hook;
}

describe("ROI batch summary out of date", () => {
  it("characterization: a fresh summary is current and exports", async () => {
    const { result } = await ran();
    expect(result.current.summaryRows).toHaveLength(2);
    expect(result.current.summaryStale).toBe(false);
    act(() => result.current.exportCsv());
    expect(saveBlobMock).toHaveBeenCalledTimes(1);
  });

  it("a moved box marks the summary out of date and withholds the export", async () => {
    const { result } = await ran();
    act(() => useApp.getState().setMapRoi({ ...RECT, x1: 5 }));
    expect(result.current.summaryStale).toBe(true);
    act(() => result.current.exportCsv());
    expect(saveBlobMock).not.toHaveBeenCalled(); // fail-before: exported the old box's numbers
    expect(result.current.outcome).not.toBeNull(); // the receipt of what landed stays
  });

  it("edited rows of a dataset that ran mark the summary out of date", async () => {
    const { result } = await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "b" ? { ...d, excludedRows: [0] } : d)) })));
    expect(result.current.summaryStale).toBe(true);
    act(() => result.current.exportCsv());
    expect(saveBlobMock).not.toHaveBeenCalled();
  });

  it("a dataset that did not run does not mark the summary", async () => {
    useApp.setState((s) => ({ datasets: [...s.datasets, { id: "c", name: "c", data: MAP() }] }));
    const { result } = await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "c" ? { ...d, excludedRows: [0] } : d)) })));
    expect(result.current.summaryStale).toBe(false);
  });

  it("applying again after a change clears the mark", async () => {
    const { result } = await ran();
    act(() => useApp.getState().setMapRoi({ ...RECT, x1: 5 }));
    await act(async () => { await result.current.applyToSelected({ ...RECT, x1: 5 }); });
    expect(result.current.summaryStale).toBe(false);
  });

  it("forced race: a box moved while the batch runs leaves the landed summary out of date", async () => {
    let land!: (r: typeof STATS) => void;
    vi.mocked(rsmBoxStats).mockImplementationOnce(() => new Promise((r) => { land = r as never; }));
    const { result } = renderHook(() => useRoiBatch());
    let pending!: Promise<void>;
    act(() => { pending = result.current.applyToSelected(RECT); });
    await act(async () => {});
    act(() => useApp.getState().setMapRoi({ ...RECT, y1: 3 }));
    await act(async () => { land(STATS); await pending; });
    expect(result.current.summaryRows.length).toBeGreaterThan(0);
    expect(result.current.summaryStale).toBe(true); // fail-before: current
  });
});
