import { describe, expect, it, vi } from "vitest";

import { commitLegendBounds } from "../../store/legendResize";
import { useApp } from "../../store/useApp";
import { resizeLegendRect } from "./LegendResizeHandles";

describe("commitLegendBounds", () => {
  it("commits position and size atomically and clears an Origin frame anchor", () => {
    const history = vi.spyOn(useApp.getState(), "recordHistory");
    useApp.setState({ legendFrameXY: [0.2, 0.3], legendSize: null });
    commitLegendBounds([0.1, 0.15], [240, 120]);
    expect(useApp.getState().legendXY).toEqual([0.1, 0.15]);
    expect(useApp.getState().legendFrameXY).toBeNull();
    expect(useApp.getState().legendSize).toEqual([240, 120]);
    expect(history).toHaveBeenCalledWith("resize legend");
    history.mockRestore();
  });
});

const bounds = { width: 400, height: 300 };
const start = { left: 50, top: 40, width: 160, height: 100 };

describe("resizeLegendRect", () => {
  it.each([
    ["n", 50, 20, 160, 120],
    ["ne", 50, 20, 190, 120],
    ["e", 50, 40, 190, 100],
    ["se", 50, 40, 190, 80],
    ["s", 50, 40, 160, 80],
    ["sw", 80, 40, 130, 80],
    ["w", 80, 40, 130, 100],
    ["nw", 80, 20, 130, 120],
  ] as const)("resizes the %s handle and preserves its opposite edge", (edge, left, top, width, height) => {
    expect(resizeLegendRect(start, edge, 30, -20, bounds)).toEqual({ left, top, width, height });
  });

  it("enforces minimum size and keeps every edge inside the plot", () => {
    expect(resizeLegendRect(start, "nw", 999, 999, bounds)).toEqual({
      left: 114, top: 100, width: 96, height: 40,
    });
    expect(resizeLegendRect(start, "se", 999, 999, bounds)).toEqual({
      left: 50, top: 40, width: 350, height: 260,
    });
  });
});
