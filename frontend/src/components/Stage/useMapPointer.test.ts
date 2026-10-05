import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import type { ArmedTool } from "./mapToolArming";
import type { MapCutsState } from "./useMapCuts";
import { useMapPointer } from "./useMapPointer";

const payload: MapPayload = {
  xAxis: [0, 1], yAxis: [0, 1], zGrid: [[1, 2], [3, 4]],
  xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "",
  zMin: 1, zMax: 4,
};

describe("useMapPointer — button ownership", () => {
  it("never starts an armed scientific gesture from a secondary-button press", () => {
    const canvas = document.createElement("canvas");
    const host = document.createElement("div");
    canvas.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300,
      width: 400, height: 300, toJSON: () => ({}),
    });
    Object.defineProperties(host, {
      clientWidth: { value: 400 }, clientHeight: { value: 300 },
    });
    const routed: ArmedTool = {
      armed: true,
      cursor: "crosshair",
      onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn(),
    };
    const cuts = { mode: "off" } as MapCutsState;
    const { result } = renderHook(() => useMapPointer({
      payload,
      canvasRef: { current: canvas } as RefObject<HTMLCanvasElement>,
      hostRef: { current: host } as RefObject<HTMLDivElement>,
      routed,
      cuts,
      hostSize: { w: 400, h: 300 },
      cutSpace: "q",
      onSlice: vi.fn(),
      onAnnotate: vi.fn(),
    }));

    act(() => result.current.onDown({ button: 2, clientX: 100, clientY: 100 } as ReactMouseEvent<HTMLCanvasElement>));
    expect(routed.onDown).not.toHaveBeenCalled();

    act(() => result.current.onDown({ button: 0, clientX: 100, clientY: 100 } as ReactMouseEvent<HTMLCanvasElement>));
    expect(routed.onDown).toHaveBeenCalledTimes(1);
  });
});
