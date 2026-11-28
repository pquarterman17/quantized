// A polygon drawn on the map is read only by ROI volume. Every consumer of a
// rectangle refuses it with the reason and never falls back to the polygon's
// bounding box: no request is sent and nothing is filled in.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats } from "../../lib/api/rsm";
import type { DataStruct } from "../../lib/types";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { useMapGrid } from "./mapgrid/useMapGrid";
import { useMapOps } from "./mapops/useMapOps";
import { useRoiBatch } from "./roicuts/useRoiBatch";
import { useRoiCuts } from "./roicuts/useRoiCuts";

vi.mock("../../lib/api/rsm", () => ({ rsmBoxCut: vi.fn(), rsmBoxStats: vi.fn(), rsmSector: vi.fn(), rsmChiProfile: vi.fn() }));

const MAP: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[60, 30, 100], [61, 30, 200], [60, 31, 150], [61, 31, 300]],
  labels: ["2Theta", "Omega", "Intensity"],
  units: ["deg", "deg", "cps"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};
const POLYGON = { space: "angular" as const, points: [[60, 30], [61, 30], [60.5, 31]] as [number, number][] };
const REFUSAL = /A polygon is drawn on the map, not a box: .* needs a rectangle/;

beforeEach(() => {
  vi.clearAllMocks();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    mapRoi: null, mapRuler: null, mapPolygon: POLYGON, savedRois: [], selectedIds: ["d1"], mapSector: {}, status: "",
    datasets: [{ id: "d1", name: "d1.xrdml", data: MAP }], activeId: "d1",
  });
});

describe("a polygon is refused by every rectangle consumer", () => {
  it("box cut and box stats (the ROI cuts workshop)", async () => {
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.runBox());
    expect(useApp.getState().status).toMatch(REFUSAL);
    await act(async () => { await result.current.runStats(); });
    expect(result.current.statsError).toMatch(REFUSAL);
    expect(rsmBoxCut).not.toHaveBeenCalled();
    expect(rsmBoxStats).not.toHaveBeenCalled();
  });

  it("the batch over the selected datasets", async () => {
    const { result } = renderHook(() => useRoiBatch());
    await act(async () => { await result.current.applyToSelected(null); });
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(REFUSAL);
    expect(rsmBoxCut).not.toHaveBeenCalled();
  });

  it("Crop (Map operations): the button is offered, and says why it does nothing", () => {
    const { result } = renderHook(() => useMapOps());
    expect(result.current.hasDrawnBox).toBe(true);
    act(() => result.current.applyDrawnBox());
    expect(result.current.error).toMatch(/needs a rectangle/);
    expect(result.current.form.xmin).toBe(""); // nothing was filled from the polygon's bounds
  });

  it("the pixel-extraction centre (Map gridding)", () => {
    const { result } = renderHook(() => useMapGrid());
    act(() => result.current.boxCentre());
    expect(result.current.error).toMatch(/needs a rectangle/);
    expect(result.current.extract.x).toBe("");
  });

  it("a box drawn afterwards replaces the polygon, and the refusal is gone", () => {
    act(() => useApp.getState().setMapRoi({ space: "angular", x0: 60, x1: 61, y0: 30, y1: 31 }));
    expect(useApp.getState().mapPolygon).toBeNull();
    const { result } = renderHook(() => useRoiCuts());
    vi.mocked(rsmBoxCut).mockResolvedValue({ time: [0], values: [[0]], labels: ["x"], units: [""], metadata: {} } as never);
    act(() => result.current.runBox());
    expect(rsmBoxCut).toHaveBeenCalledTimes(1);
  });
});
