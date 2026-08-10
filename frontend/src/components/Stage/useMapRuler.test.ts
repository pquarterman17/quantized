// Mocked-hook tests for useMapRuler.ts (RSM_CUTS_PLAN item 7), same style as
// useMapRoi.test.ts: mock the backend wrappers, drive the hook's own
// handlers directly (no canvas/DOM needed — px inputs are derived from the
// SAME dataToPx the hook uses, so a chosen data-space point round-trips
// through real projection math).
//
// Coverage: draw builds a ruler from the drag vector (centre/length/angle);
// move translates; an end-handle drag both lengthens AND rotates (the
// ruler's only "rotate" affordance — no separate rotation handle); a
// width-handle drag grows the width symmetrically; Esc mid-drag restores
// the pre-gesture ruler; a nudge steps one payload cell; a sub-3px drag is
// discarded; a fresh ruler draw retires any live box (mutual exclusivity);
// inline ∫x posts the rotated box body and lands exactly one dataset; and
// the preview path (draw/drag) NEVER calls the backend.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats } from "../../lib/api/rsm";
import { cancelActiveGesture } from "../../lib/gestureCancel";
import type { MapPayload } from "../../lib/mapdata";
import * as roiMathModule from "../../lib/roiMath";
import type { Dataset, DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { dataToPx } from "./mapRender";
import { useMapRuler } from "./useMapRuler";

vi.mock("../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(),
  rsmBoxStats: vi.fn(),
}));

vi.mock("../../lib/roiMath", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/roiMath")>();
  return {
    ...actual,
    boxProfileLocal: vi.fn(actual.boxProfileLocal),
    boxStatsLocal: vi.fn(actual.boxStatsLocal),
  };
});

const W = 400;
const H = 300;

// Same 5x4 (2Theta x Omega) grid convention as useMapRoi.test.ts — angular
// units so plotRect fills the pane (no aspect lock), a plain affine map.
const PAYLOAD: MapPayload = {
  xAxis: [10, 11, 12, 13, 14],
  yAxis: [0, 1, 2, 3],
  zGrid: [
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8, 9],
    [10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19],
  ],
  xLabel: "2Theta",
  xUnit: "deg",
  yLabel: "Omega",
  yUnit: "deg",
  zLabel: "Intensity",
  zUnit: "cps",
  zMin: 0,
  zMax: 19,
};

function buildRows(): number[][] {
  const tt = [10, 11, 12, 13, 14];
  const om = [0, 1, 2, 3];
  const rows: number[][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) rows.push([tt[c]!, om[r]!, r * 5 + c]);
  return rows;
}

const DS: DataStruct = {
  time: Array.from({ length: 20 }, (_, i) => i),
  values: buildRows(),
  labels: ["2Theta", "Omega", "Intensity"],
  units: ["deg", "deg", "cps"],
  metadata: { is2D: true, axis1_name: "Omega", map_shape: [4, 5] },
};

const ACTIVE: Dataset = { id: "d1", name: "d1.xrdml", data: DS };

const CUT_RESULT: DataStruct = {
  time: [0, 1],
  values: [
    [0.5, 10],
    [0.6, 12],
  ],
  labels: ["Intensity", "N points"],
  units: ["cps", ""],
  metadata: { cut_label: "box cut" },
};

/** Data -> px via the SAME projector the hook uses, so a chosen data point
 *  round-trips exactly through the hook's own pxToData. */
function px(x: number, y: number): [number, number] {
  const p = dataToPx(PAYLOAD, W, H, x, y);
  if (!p) throw new Error(`(${x}, ${y}) projects outside the plot rect`);
  return p;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// jsdom's requestAnimationFrame never fires on its own — capture (don't
// auto-fire) so tests control exactly when the coalesced preview compute
// runs, same convention as useMapRoi.test.ts.
let rafCb: FrameRequestCallback | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ mapRoi: null, mapRuler: null, datasets: [ACTIVE], activeId: ACTIVE.id });
  rafCb = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafCb = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMapRuler — gesture state machine", () => {
  it("draw builds a ruler from the drag vector: centre, length, angle", () => {
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(12, 1)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(11, 3)));
    act(() => result.current.onUp(px(11, 3)));

    const ruler = useApp.getState().mapRuler!;
    expect(ruler.space).toBe("angular");
    expect(ruler.cx).toBeCloseTo(11.5);
    expect(ruler.cy).toBeCloseTo(2);
    expect(ruler.length).toBeCloseTo(Math.sqrt(5));
    expect(ruler.angle).toBeCloseTo((Math.atan2(2, -1) * 180) / Math.PI);
    expect(ruler.width).toBeGreaterThan(0);
  });

  it("move translates the ruler by the drag delta", () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 11.5, cy: 1.5, angle: 0, length: 1, width: 1 } });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11.5, 1.5))); // interior (centre)
    act(() => result.current.onMove(PAYLOAD, W, H, px(12.5, 2.5))); // +1, +1
    act(() => result.current.onUp(px(12.5, 2.5)));

    const ruler = useApp.getState().mapRuler!;
    expect(ruler.cx).toBeCloseTo(12.5);
    expect(ruler.cy).toBeCloseTo(2.5);
    expect(ruler.angle).toBeCloseTo(0);
    expect(ruler.length).toBeCloseTo(1);
  });

  it("dragging an end handle both lengthens and rotates the ruler (its only rotate affordance)", () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 12, cy: 1, angle: 0, length: 2, width: 1 } });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(13, 1))); // "end 0" handle
    act(() => result.current.onMove(PAYLOAD, W, H, px(13, 3))); // drag that end up
    act(() => result.current.onUp(px(13, 3)));

    const ruler = useApp.getState().mapRuler!;
    // The OTHER end (11, 1) stays anchored; new endpoint lands near (13, 3).
    expect(ruler.cx).toBeCloseTo(12);
    expect(ruler.cy).toBeCloseTo(2);
    expect(ruler.length).toBeCloseTo(Math.sqrt(8));
    expect(ruler.angle).toBeCloseTo(45);
  });

  it("dragging a width handle grows the width symmetrically about the centreline", () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 12, cy: 1, angle: 0, length: 2, width: 1 } });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(12, 0.5))); // "width 0" handle
    act(() => result.current.onMove(PAYLOAD, W, H, px(12, 0))); // drag further from centreline
    act(() => result.current.onUp(px(12, 0)));

    const ruler = useApp.getState().mapRuler!;
    expect(ruler.width).toBeCloseTo(2);
    expect(ruler.cx).toBeCloseTo(12); // centre/angle/length untouched
    expect(ruler.cy).toBeCloseTo(1);
    expect(ruler.angle).toBeCloseTo(0);
    expect(ruler.length).toBeCloseTo(2);
  });

  it("Esc mid-drag restores the pre-gesture ruler", () => {
    const original = { space: "angular" as const, cx: 11.5, cy: 1.5, angle: 0, length: 1, width: 1 };
    useApp.setState({ mapRuler: original });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11.5, 1.5)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(13, 3)));
    expect(useApp.getState().mapRuler).not.toEqual(original);

    act(() => {
      expect(cancelActiveGesture()).toBe(true);
    });
    expect(useApp.getState().mapRuler).toEqual(original);
  });

  it("leaving the canvas mid-drag aborts it the same way Esc does", () => {
    const original = { space: "angular" as const, cx: 11.5, cy: 1.5, angle: 0, length: 1, width: 1 };
    useApp.setState({ mapRuler: original });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11.5, 1.5)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(13, 3)));
    act(() => result.current.onLeave());
    expect(useApp.getState().mapRuler).toEqual(original);
  });

  it("a sub-3px drag is discarded (a fresh draw never commits)", () => {
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    const start = px(12, 1.5);
    act(() => result.current.onDown(PAYLOAD, W, H, start));
    act(() => result.current.onUp([start[0] + 1, start[1]]));
    expect(useApp.getState().mapRuler).toBeNull();
  });

  it("arrow keys nudge one payload cell, x10 with Shift", () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 11.5, cy: 1.5, angle: 0, length: 1, width: 1 } });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    const prevent = vi.fn();
    act(() => result.current.onKeyDown({ key: "ArrowRight", shiftKey: false, preventDefault: prevent }, PAYLOAD));
    let ruler = useApp.getState().mapRuler!;
    expect(ruler.cx).toBeCloseTo(12.5); // xAxis cell = 1
    expect(prevent).toHaveBeenCalled();

    act(() => result.current.onKeyDown({ key: "ArrowUp", shiftKey: true, preventDefault: vi.fn() }, PAYLOAD));
    ruler = useApp.getState().mapRuler!;
    expect(ruler.cy).toBeCloseTo(11.5); // yAxis cell = 1, x10 shift
  });

  it("Delete clears the ruler", () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 11.5, cy: 1.5, angle: 0, length: 1, width: 1 } });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.onKeyDown({ key: "Delete", shiftKey: false, preventDefault: vi.fn() }, PAYLOAD));
    expect(useApp.getState().mapRuler).toBeNull();
  });

  it("a fresh ruler draw retires any live box (mutually exclusive working shapes)", () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 10, x1: 11, y0: 0, y1: 1 } });
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(12, 1)));
    expect(useApp.getState().mapRoi).toBeNull();
  });
});

describe("useMapRuler — inline commit (backend actions)", () => {
  it("∫x posts the ruler-shaped (rotated) box body and lands exactly one dataset", async () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 12, cy: 1, angle: 30, length: 2, width: 1 } });
    vi.mocked(rsmBoxCut).mockResolvedValue(CUT_RESULT);
    const before = useApp.getState().datasets.length;
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));

    act(() => result.current.commitIntegrate("x"));
    await flush();

    expect(rsmBoxCut).toHaveBeenCalledTimes(1);
    const body = vi.mocked(rsmBoxCut).mock.calls[0]![0];
    expect(body).toMatchObject({ x_min: 11, x_max: 13, y_min: 0.5, y_max: 1.5, space: "angular", angle: 30, collapse: "x" });
    expect(useApp.getState().datasets.length).toBe(before + 1);
  });

  it("Stats fetches box_stats from the backend and shows it inline without landing a dataset", async () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 12, cy: 1, angle: 0, length: 2, width: 1 } });
    const stats = {
      n_points: 4,
      integrated_intensity: 30,
      mean_intensity: 7.5,
      max_intensity: 13,
      peak_x: 12,
      peak_y: 1,
      centroid_x: 11.5,
      centroid_y: 1,
      x_min: 11,
      x_max: 13,
      y_min: 0.5,
      y_max: 1.5,
      space: "angular" as const,
      angle: 0,
      wrap: null,
    };
    vi.mocked(rsmBoxStats).mockResolvedValue(stats);
    const before = useApp.getState().datasets.length;
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));

    act(() => result.current.commitStats());
    await flush();

    expect(rsmBoxStats).toHaveBeenCalledTimes(1);
    expect(result.current.apiStats).toEqual(stats);
    expect(useApp.getState().datasets.length).toBe(before); // a scalar dict, nothing to land
  });

  it("surfaces a Stats error and clears it via clearStats", async () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 12, cy: 1, angle: 0, length: 2, width: 1 } });
    vi.mocked(rsmBoxStats).mockRejectedValue(new Error("box selects no data"));
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));

    act(() => result.current.commitStats());
    await flush();
    expect(result.current.statsError).toContain("box selects no data");

    act(() => result.current.clearStats());
    expect(result.current.apiStats).toBeNull();
  });
});

describe("useMapRuler — client preview never touches the backend", () => {
  it("a full draw/drag gesture never calls rsmBoxCut or rsmBoxStats", () => {
    const { result } = renderHook(() => useMapRuler(ACTIVE, "angular"));
    act(() => result.current.setMode("ruler"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11, 1)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(13, 3)));
    act(() => result.current.onUp(px(13, 3)));
    act(() => {
      rafCb?.(0); // flush the coalesced preview compute, if any
    });
    expect(rsmBoxCut).not.toHaveBeenCalled();
    expect(rsmBoxStats).not.toHaveBeenCalled();
  });

  it("preview is rAF-coalesced: several ruler updates within one frame compute at most once, from the latest ruler", () => {
    useApp.setState({ mapRuler: { space: "angular", cx: 12, cy: 1, angle: 0, length: 2, width: 1 } });
    renderHook(() => useMapRuler(ACTIVE, "angular"));

    act(() => useApp.getState().setMapRuler({ space: "angular", cx: 12.1, cy: 1, angle: 0, length: 2, width: 1 }));
    act(() => useApp.getState().setMapRuler({ space: "angular", cx: 12.2, cy: 1, angle: 0, length: 2, width: 1 }));
    act(() => useApp.getState().setMapRuler({ space: "angular", cx: 12.3, cy: 1, angle: 0, length: 2, width: 1 }));
    expect(roiMathModule.boxProfileLocal).not.toHaveBeenCalled(); // still pending the frame

    act(() => {
      rafCb?.(0);
    });
    expect(roiMathModule.boxProfileLocal).toHaveBeenCalledTimes(1);
    const lastRect = vi.mocked(roiMathModule.boxProfileLocal).mock.calls[0]![1];
    expect(lastRect.x1).toBeCloseTo(13.3); // cx=12.3 + hl=1 -> the LATEST ruler
  });
});
