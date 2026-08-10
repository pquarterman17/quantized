// Mocked-hook tests for useMapRoi.ts (RSM_CUTS_PLAN item 6), same style as
// workshops/rsm/useRsm.test.ts / workshops/roicuts/useRoiCuts.test.ts: mock
// the backend wrappers, drive the hook's own handlers directly (no canvas/
// DOM needed — px inputs are derived from the SAME dataToPx the hook uses,
// so a chosen data-space point round-trips through real projection math).
//
// Coverage mirrors the plan's acceptance list: draw commits a normalized
// rect; move translates; a resize with crossover re-normalizes; Esc mid-
// drag restores the pre-gesture rect; a nudge steps one payload cell; a
// sub-3px drag is discarded; inline ∫x posts the shaped body and lands
// exactly one dataset; and — the guard that matters most — the preview path
// (draw/drag) NEVER calls the backend, while the rAF-coalesced compute
// itself runs at most once per frame.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats } from "../../lib/api/rsm";
import { cancelActiveGesture } from "../../lib/gestureCancel";
import type { MapPayload } from "../../lib/mapdata";
import * as roiMathModule from "../../lib/roiMath";
import type { Dataset, DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { dataToPx } from "./mapRender";
import { useMapRoi } from "./useMapRoi";

vi.mock("../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(),
  rsmBoxStats: vi.fn(),
}));

// Wraps the REAL implementation (so preview state still works end-to-end)
// while making call counts/arguments assertable — the importOriginal
// pattern useGraphBuilder.test.ts already established for this repo.
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

// A 5x4 (2Theta x Omega) grid — same shape convention roiMath.test.ts's
// `handGrid` uses — angular units so plotRect fills the pane (no aspect
// lock), which keeps the px<->data math a plain affine map.
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
// runs, same convention as PlotLegend.test.tsx's rAF-throttled drag.
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

describe("useMapRoi — gesture state machine", () => {
  it("draw commits a normalized rect between the down and up points, in either direction", () => {
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(12, 1)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(11, 3)));
    act(() => result.current.onUp(px(11, 3)));

    const rect = useApp.getState().mapRoi;
    expect(rect?.space).toBe("angular");
    expect(rect?.x0).toBeCloseTo(11);
    expect(rect?.x1).toBeCloseTo(12);
    expect(rect?.y0).toBeCloseTo(1);
    expect(rect?.y1).toBeCloseTo(3);
  });

  it("move translates the box by the drag delta", () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 12, y0: 1, y1: 2 } });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11.5, 1.5))); // interior
    act(() => result.current.onMove(PAYLOAD, W, H, px(12.5, 2.5))); // +1, +1
    act(() => result.current.onUp(px(12.5, 2.5)));

    const rect = useApp.getState().mapRoi!;
    expect(rect.x0).toBeCloseTo(12);
    expect(rect.x1).toBeCloseTo(13);
    expect(rect.y0).toBeCloseTo(2);
    expect(rect.y1).toBeCloseTo(3);
  });

  it("a corner resize dragged past the opposite edge re-normalizes (crossover)", () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 13, y0: 1, y1: 2 } });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(13, 2))); // NE handle
    act(() => result.current.onMove(PAYLOAD, W, H, px(10, 2))); // dragged past x0=11
    act(() => result.current.onUp(px(10, 2)));

    const rect = useApp.getState().mapRoi!;
    expect(rect.x0).toBeCloseTo(10);
    expect(rect.x1).toBeCloseTo(11);
  });

  it("Esc mid-drag restores the pre-gesture rect", () => {
    const original = { space: "angular" as const, x0: 11, x1: 12, y0: 1, y1: 2 };
    useApp.setState({ mapRoi: original });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11.5, 1.5)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(13, 3)));
    expect(useApp.getState().mapRoi).not.toEqual(original);

    act(() => {
      expect(cancelActiveGesture()).toBe(true);
    });
    expect(useApp.getState().mapRoi).toEqual(original);
  });

  it("leaving the canvas mid-drag aborts it the same way Esc does", () => {
    const original = { space: "angular" as const, x0: 11, x1: 12, y0: 1, y1: 2 };
    useApp.setState({ mapRoi: original });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11.5, 1.5)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(13, 3)));
    act(() => result.current.onLeave());
    expect(useApp.getState().mapRoi).toEqual(original);
  });

  it("a sub-3px drag is discarded (a fresh draw never commits)", () => {
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    const start = px(12, 1.5);
    act(() => result.current.onDown(PAYLOAD, W, H, start));
    act(() => result.current.onUp([start[0] + 1, start[1]]));
    expect(useApp.getState().mapRoi).toBeNull();
  });

  it("a sub-3px drag on an existing box is a no-op click, not a move", () => {
    const original = { space: "angular" as const, x0: 11, x1: 12, y0: 1, y1: 2 };
    useApp.setState({ mapRoi: original });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    const start = px(11.5, 1.5);
    act(() => result.current.onDown(PAYLOAD, W, H, start));
    act(() => result.current.onMove(PAYLOAD, W, H, [start[0] + 1, start[1]]));
    act(() => result.current.onUp([start[0] + 1, start[1]]));
    expect(useApp.getState().mapRoi).toEqual(original);
  });

  it("arrow keys nudge one payload cell, x10 with Shift", () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 12, y0: 1, y1: 2 } });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    const prevent = vi.fn();
    act(() => result.current.onKeyDown({ key: "ArrowRight", shiftKey: false, preventDefault: prevent }, PAYLOAD));
    let rect = useApp.getState().mapRoi!;
    expect(rect.x0).toBeCloseTo(12); // xAxis cell = 1
    expect(rect.x1).toBeCloseTo(13);
    expect(prevent).toHaveBeenCalled();

    act(() => result.current.onKeyDown({ key: "ArrowUp", shiftKey: true, preventDefault: vi.fn() }, PAYLOAD));
    rect = useApp.getState().mapRoi!;
    expect(rect.y0).toBeCloseTo(11); // yAxis cell = 1, x10 shift
    expect(rect.y1).toBeCloseTo(12);
  });

  it("Delete clears the box", () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 12, y0: 1, y1: 2 } });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.onKeyDown({ key: "Delete", shiftKey: false, preventDefault: vi.fn() }, PAYLOAD));
    expect(useApp.getState().mapRoi).toBeNull();
  });

  it("a rect drawn in a hidden (mismatched) space still restores correctly on a discarded click", () => {
    // A box exists in "q" space but the map is currently displaying angular
    // axes — rect is hidden (mismatch), so a click starts a fresh "draw"
    // whose pre-gesture value is the RAW (hidden) store rect, not null.
    const hidden = { space: "q" as const, x0: 0.1, x1: 0.2, y0: 4, y1: 5 };
    useApp.setState({ mapRoi: hidden });
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    expect(result.current.rect).toBeNull(); // hidden — space mismatch
    act(() => result.current.setMode("roi"));
    const start = px(12, 1.5);
    act(() => result.current.onDown(PAYLOAD, W, H, start));
    act(() => result.current.onUp([start[0] + 1, start[1]])); // sub-3px: discard
    expect(useApp.getState().mapRoi).toEqual(hidden);
  });
});

describe("useMapRoi — inline commit (backend actions)", () => {
  it("∫x posts the shaped box body and lands exactly one dataset", async () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 12, y0: 1, y1: 2 } });
    vi.mocked(rsmBoxCut).mockResolvedValue(CUT_RESULT);
    const before = useApp.getState().datasets.length;
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));

    act(() => result.current.commitIntegrate("x"));
    await flush();

    expect(rsmBoxCut).toHaveBeenCalledTimes(1);
    const body = vi.mocked(rsmBoxCut).mock.calls[0]![0];
    expect(body).toMatchObject({ x_min: 11, x_max: 12, y_min: 1, y_max: 2, space: "angular", collapse: "x" });
    expect(useApp.getState().datasets.length).toBe(before + 1);
  });

  it("Stats fetches box_stats from the backend and shows it inline without landing a dataset", async () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 12, y0: 1, y1: 2 } });
    const stats = {
      n_points: 4,
      integrated_intensity: 30,
      mean_intensity: 7.5,
      max_intensity: 13,
      peak_x: 12,
      peak_y: 2,
      centroid_x: 11.5,
      centroid_y: 1.5,
      x_min: 11,
      x_max: 12,
      y_min: 1,
      y_max: 2,
      space: "angular" as const,
      angle: 0,
      wrap: null,
    };
    vi.mocked(rsmBoxStats).mockResolvedValue(stats);
    const before = useApp.getState().datasets.length;
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));

    act(() => result.current.commitStats());
    await flush();

    expect(rsmBoxStats).toHaveBeenCalledTimes(1);
    expect(result.current.apiStats).toEqual(stats);
    expect(useApp.getState().datasets.length).toBe(before); // a scalar dict, nothing to land
  });

  it("surfaces a Stats error and clears it via clearStats", async () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 12, y0: 1, y1: 2 } });
    vi.mocked(rsmBoxStats).mockRejectedValue(new Error("box selects no data"));
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));

    act(() => result.current.commitStats());
    await flush();
    expect(result.current.statsError).toContain("box selects no data");

    act(() => result.current.clearStats());
    expect(result.current.apiStats).toBeNull();
  });
});

describe("useMapRoi — client preview never touches the backend", () => {
  it("a full draw/drag gesture never calls rsmBoxCut or rsmBoxStats", () => {
    const { result } = renderHook(() => useMapRoi(ACTIVE, "angular"));
    act(() => result.current.setMode("roi"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(11, 1)));
    act(() => result.current.onMove(PAYLOAD, W, H, px(13, 3)));
    act(() => result.current.onUp(px(13, 3)));
    act(() => {
      rafCb?.(0); // flush the coalesced preview compute, if any
    });
    expect(rsmBoxCut).not.toHaveBeenCalled();
    expect(rsmBoxStats).not.toHaveBeenCalled();
  });

  it("preview is rAF-coalesced: several rect updates within one frame compute at most once, from the latest rect", () => {
    useApp.setState({ mapRoi: { space: "angular", x0: 11, x1: 12, y0: 1, y1: 2 } });
    renderHook(() => useMapRoi(ACTIVE, "angular"));

    act(() => useApp.getState().setMapRoi({ space: "angular", x0: 11, x1: 12.1, y0: 1, y1: 2 }));
    act(() => useApp.getState().setMapRoi({ space: "angular", x0: 11, x1: 12.2, y0: 1, y1: 2 }));
    act(() => useApp.getState().setMapRoi({ space: "angular", x0: 11, x1: 12.3, y0: 1, y1: 2 }));
    expect(roiMathModule.boxProfileLocal).not.toHaveBeenCalled(); // still pending the frame

    act(() => {
      rafCb?.(0);
    });
    expect(roiMathModule.boxProfileLocal).toHaveBeenCalledTimes(1);
    const lastRect = vi.mocked(roiMathModule.boxProfileLocal).mock.calls[0]![1];
    expect(lastRect.x1).toBeCloseTo(12.3); // the LATEST rect, not a stale intermediate one
  });
});
