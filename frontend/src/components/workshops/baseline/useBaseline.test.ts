import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyCorrections as applyCorrectionsApi,
  baselineALS,
  baselineAnchor,
  baselineEstimate,
  baselineModPoly,
  baselineRegion,
  baselineRollingBall,
  baselineShirley,
  baselineXrdLowAngle,
  fetchBookData,
} from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useBaseline } from "./useBaseline";

vi.mock("../../../lib/api", () => ({
  applyCorrections: vi.fn(),
  baselineALS: vi.fn(),
  baselineAnchor: vi.fn(),
  baselineEstimate: vi.fn(),
  baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(),
  baselineRollingBall: vi.fn(),
  baselineShirley: vi.fn(),
  baselineXrdLowAngle: vi.fn(),
  fetchBookData: vi.fn(),
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
    baselineAnchorEdit: null,
    plotTool: "zoom",
    regionPicked: null,
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

  it("region defaults the box to the full x-range when edges are unset", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [10, 10, 10, 10], coeffs: [0, 10], n_points: 4,
      mean: 10, std: 0, min: 10, max: 10, order: 1,
    });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("region"));
    await act(async () => {
      await result.current.compute();
    });

    expect(baselineRegion).toHaveBeenCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 1, x_max: 4, order: 5,
    });
    expect(result.current.baseline).toEqual([10, 10, 10, 10]);
  });

  it("arming the rubber-band sets the plot tool to region", () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("region"));
    act(() => result.current.pickRegion());
    expect(useApp.getState().plotTool).toBe("region");
  });

  it("consumes a store-picked range into the box edges then clears it", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [5, 5, 5, 5], coeffs: [0, 5], n_points: 2,
      mean: 5, std: 0, min: 5, max: 5, order: 1,
    });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("region"));

    // The plot's rubber-band writes [x_min,x_max] to the store (already ordered).
    act(() => useApp.getState().setRegionPicked([2, 3]));

    // The hook pulls it into the params and consumes it (resets to null).
    expect(useApp.getState().regionPicked).toBeNull();
    expect(result.current.params.regionXMin).toBe(2);
    await act(async () => {
      await result.current.compute();
    });
    expect(baselineRegion).toHaveBeenCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 2, x_max: 3, order: 5,
    });
  });

  it("region uses explicit box edges + order when set", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [0, 0, 0, 0], coeffs: [0, 0], n_points: 2,
      mean: 0, std: 0, min: 0, max: 0, order: 2,
    });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("region"));
    act(() => result.current.setParams({ regionXMin: 2, regionXMax: 3, order: 2 }));
    await act(async () => {
      await result.current.compute();
    });

    expect(baselineRegion).toHaveBeenCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 2, x_max: 3, order: 2,
    });
  });

  it("subtract writes a new background-subtracted dataset", async () => {
    vi.mocked(baselineModPoly).mockResolvedValue({ baseline: [1, 2, 1, 3], info: {} });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("modpoly"));
    await act(async () => {
      await result.current.compute();
    });
    await act(async () => {
      await result.current.subtract();
    });

    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    const sub = ds[1];
    expect(sub.name).toBe("scan (bg-sub)");
    expect(sub.data.values).toEqual([[9], [10], [10], [10]]); // y - baseline
    expect(sub.data.metadata.baseline_subtracted).toBe("modpoly");
  });

  it("subtract is a no-op before an estimate exists", async () => {
    const { result } = renderHook(() => useBaseline());
    await act(async () => {
      await result.current.subtract();
    });
    expect(useApp.getState().datasets).toHaveLength(1); // nothing added
  });

  it("compute resolves a still-pending active dataset before estimating", async () => {
    vi.mocked(baselineALS).mockResolvedValue({ baseline: [1, 1, 1, 1] });
    const full: DataStruct = {
      time: [1, 2, 3, 4, 5],
      values: [[10], [12], [11], [13], [14]],
      labels: ["I"],
      units: ["cps"],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [1, 2], values: [[10], [12]], labels: ["I"], units: ["cps"], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5, cols: 1 },
        },
      ],
      activeId: "d1",
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);
    const { result } = renderHook(() => useBaseline());

    await act(async () => {
      await result.current.compute();
    });

    expect(baselineALS).toHaveBeenCalledWith({ y: full.values.map((r) => r[0]), lam: 1e6, p: 0.01 });
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
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

  it("Shirley passes x, y and the iteration cap", async () => {
    vi.mocked(baselineShirley).mockResolvedValue({ baseline: [1, 1, 1, 1], info: {} });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("shirley"));
    act(() => result.current.setParams({ maxIter: 80 }));
    await act(async () => {
      await result.current.compute();
    });

    expect(baselineShirley).toHaveBeenCalledWith({
      x: [1, 2, 3, 4],
      y: [10, 12, 11, 13],
      max_iter: 80,
    });
  });

  it("XRD low-angle passes x and y", async () => {
    vi.mocked(baselineXrdLowAngle).mockResolvedValue({ baseline: [0, 0, 0, 0], info: {} });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("xrdla"));
    await act(async () => {
      await result.current.compute();
    });

    expect(baselineXrdLowAngle).toHaveBeenCalledWith({ x: [1, 2, 3, 4], y: [10, 12, 11, 13] });
  });

  it("linear/quadratic/poly reuse the region-fit calc over the full range (#8)", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [0, 0, 0, 0], coeffs: [0, 0], n_points: 4,
      mean: 0, std: 0, min: 0, max: 0, order: 1,
    });
    const { result } = renderHook(() => useBaseline());

    act(() => result.current.setMethod("linear"));
    await act(async () => {
      await result.current.compute();
    });
    expect(baselineRegion).toHaveBeenLastCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 1, x_max: 4, order: 1,
    });

    act(() => result.current.setMethod("quadratic"));
    await act(async () => {
      await result.current.compute();
    });
    expect(baselineRegion).toHaveBeenLastCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 1, x_max: 4, order: 2,
    });

    act(() => result.current.setMethod("poly"));
    act(() => result.current.setParams({ order: 4 }));
    await act(async () => {
      await result.current.compute();
    });
    expect(baselineRegion).toHaveBeenLastCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 1, x_max: 4, order: 4,
    });
  });

  it("analytic methods ignore a leftover region box (always full range)", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [0, 0, 0, 0], coeffs: [0, 0], n_points: 4,
      mean: 0, std: 0, min: 0, max: 0, order: 1,
    });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setParams({ regionXMin: 2, regionXMax: 3 }));
    act(() => result.current.setMethod("linear"));
    await act(async () => {
      await result.current.compute();
    });
    expect(baselineRegion).toHaveBeenLastCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 1, x_max: 4, order: 1,
    });
  });
});

describe("useBaseline anchor method (GOTO #2)", () => {
  it("publishes the plot bridge while live; clicks accumulate anchors", () => {
    const { result } = renderHook(() => useBaseline());
    expect(useApp.getState().baselineAnchorEdit).toBeNull();

    act(() => result.current.setMethod("anchor"));
    const bridge = useApp.getState().baselineAnchorEdit;
    expect(bridge).not.toBeNull();
    expect(bridge!.anchors).toEqual([]);

    act(() => bridge!.addAnchor(2, 11));
    expect(result.current.anchors).toEqual([[2, 11]]);
    // The re-published bridge carries the updated, index-tagged anchor list.
    expect(useApp.getState().baselineAnchorEdit!.anchors).toEqual([{ index: 0, x: 2, y: 11 }]);
  });

  it("bridge move/remove edit the anchor list in place", () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(4, 13));

    act(() => useApp.getState().baselineAnchorEdit!.moveAnchor(0, 1.5, 10.5));
    expect(result.current.anchors).toEqual([
      [1.5, 10.5],
      [4, 13],
    ]);

    act(() => useApp.getState().baselineAnchorEdit!.removeAnchor(1));
    expect(result.current.anchors).toEqual([[1.5, 10.5]]);
  });

  it("switching away from anchor clears the bridge", () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    expect(useApp.getState().baselineAnchorEdit).not.toBeNull();
    act(() => result.current.setMethod("als"));
    expect(useApp.getState().baselineAnchorEdit).toBeNull();
  });

  it("compute posts anchors + interpolation method", async () => {
    vi.mocked(baselineAnchor).mockResolvedValue({ baseline: [10, 11, 12, 13] });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(4, 13));
    act(() => result.current.setParams({ anchorMethod: "linear" }));

    await act(async () => {
      await result.current.compute();
    });

    expect(baselineAnchor).toHaveBeenCalledWith({
      x: [1, 2, 3, 4],
      y: [10, 12, 11, 13],
      anchors: [
        [1, 10],
        [4, 13],
      ],
      method: "linear",
    });
    expect(useApp.getState().baselineOverlay).toEqual({ datasetId: "d1", y: [10, 11, 12, 13] });
  });

  it("live preview (debounced) fires once the 2nd anchor lands", async () => {
    vi.mocked(baselineAnchor).mockResolvedValue({ baseline: [10, 11, 12, 13] });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    expect(baselineAnchor).not.toHaveBeenCalled(); // 1 anchor: no preview yet
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(4, 13));

    await waitFor(() => expect(baselineAnchor).toHaveBeenCalledTimes(1));
    expect(useApp.getState().baselineOverlay).not.toBeNull();
  });

  it("compute with fewer than 2 anchors errors without calling the API", async () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toContain("2 anchors");
    expect(baselineAnchor).not.toHaveBeenCalled();
  });

  it("Apply subtracts through the corrections chokepoint (bgAnchors params)", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({
      ...raw,
      values: [[0], [1], [0], [1]],
    });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(4, 12));

    await act(async () => {
      await result.current.applyAnchors();
    });

    // The store's applyCorrections chokepoint got the anchors as params —
    // the SAME path the Corrections card / pipeline step executor replay.
    expect(applyCorrectionsApi).toHaveBeenCalledWith({
      dataset: raw,
      params: {
        bgAnchors: [
          [1, 10],
          [4, 12],
        ],
        bgAnchorMethod: "pchip",
      },
    });
    const ds = useApp.getState().datasets[0];
    expect(ds.data.values).toEqual([[0], [1], [0], [1]]);
    expect(ds.corrections?.bgAnchors).toEqual([
      [1, 10],
      [4, 12],
    ]);
    expect(ds.raw).toEqual(raw); // replace-not-accumulate: pristine raw kept
    // The hook consumed the anchors + overlay after a successful apply.
    expect(result.current.anchors).toEqual([]);
    expect(useApp.getState().baselineOverlay).toBeNull();
  });

  it("Apply is a no-op below 2 anchors", async () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    await act(async () => {
      await result.current.applyAnchors();
    });
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
  });

  it("switching datasets clears the anchors", () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    expect(result.current.anchors).toHaveLength(1);

    act(() =>
      useApp.setState({
        datasets: [
          { id: "d1", name: "scan.dat", data: raw },
          { id: "d2", name: "other.dat", data: raw },
        ],
        activeId: "d2",
      }),
    );
    expect(result.current.anchors).toEqual([]);
  });
});
