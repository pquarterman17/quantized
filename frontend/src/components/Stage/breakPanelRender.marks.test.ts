// Gap audit 3: spline / size-by / drop lines are not drawn in x-break panels (the
// export warns the same: tests/test_calc_figure_marks.py). Real uPlot; jsdom lacks
// `matchMedia` and `Path2D`, stubbed before the import.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as { Path2D?: unknown };
  g.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    rect() {}
    arc() {}
    closePath() {}
    addPath() {}
    bezierCurveTo() {}
  };
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
});

import type uPlot from "uplot";

import type { BreakPanel } from "../../lib/facet";
import type { PlotPayload } from "../../lib/plotdata";
import { plainStyle, renderBreakPanels } from "./breakPanelRender";

let plots: uPlot[] = [];
afterEach(() => {
  plots.forEach((u) => u.destroy());
  plots = [];
});

const panel = (xs: number[], xRange: [number, number]): BreakPanel => ({
  payload: { data: [xs, xs.map((x) => x * 2)], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" } as PlotPayload,
  channels: [0],
  xRange,
});

describe("break panels and the data-driven marks", () => {
  it("plainStyle strips the marks and keeps the rest", () => {
    expect(plainStyle({ connect: "spline", dropLines: "x", sizeBy: 1, color: "#f00" })).toEqual({
      connect: undefined, dropLines: undefined, sizeBy: undefined, color: "#f00",
    });
    const plain = { color: "#f00" };
    expect(plainStyle(plain)).toBe(plain);
    expect(plainStyle(undefined)).toBeUndefined();
    // The magnifier inset keeps the spline (the export's inset copies it) and drops the rest.
    expect(plainStyle({ connect: "spline", dropLines: "x", sizeBy: 1 }, ["dropLines", "sizeBy"])).toMatchObject({
      connect: "spline", dropLines: undefined, sizeBy: undefined,
    });
  });

  it("a break panel draws a spline / size-by series as an ordinary visible line, with no mark plugin", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    plots = renderBreakPanels(host, {
      panels: [panel([0, 1, 2], [0, 2]), panel([3, 4, 5], [3, 5])],
      seriesLabels: {},
      seriesStyles: { 0: { connect: "spline", sizeBy: 0, dropLines: "both", width: 2 } },
      hiddenChannels: [],
      syncKey: "break-marks",
      box: { w: 800, h: 300 },
      cell: { xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn() },
    });
    await new Promise((r) => setTimeout(r, 0));
    for (const u of plots) {
      const s = u.series[1] as { width?: number; paths?: unknown; show?: boolean };
      expect(s.width).toBe(2); // visible (a pending-mark series would be hidden at width 0)
      expect(s.show).not.toBe(false);
    }
  });
});
