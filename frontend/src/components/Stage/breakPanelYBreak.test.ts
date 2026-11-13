// Review finding: an X break (side-by-side panels) plus a Y break. The
// shared y was padded as an UNBROKEN axis (0..1200 for 0..1020 data with a
// 15..995 break, labels piled into the lower stretch), and each panel sized
// its break gap from its own x-slice, so the panels placed one y value at
// different heights. The shared range is now the broken axis' own auto range
// over ALL panels' data (as the export's single shared break,
// tests/test_axis_breaks.py "x and y breaks"), and every panel's gap comes
// from that one extent.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

import uPlot from "uplot";

import { breakAutoRange } from "../../lib/axisBreaks";
import { loadAxisExtras } from "../../lib/axisExtrasHook";
import type { BreakPanel } from "../../lib/facet";
import type { PlotPayload } from "../../lib/plotdata";
import { renderBreakPanels } from "./breakPanelRender";

function panel(xs: number[], ys: number[], xRange: [number, number]): BreakPanel {
  const payload: PlotPayload = { data: [xs, ys] as PlotPayload["data"], series: [{ label: "S", unit: "" }], xLabel: "x", xUnit: "" };
  return { payload, channels: [0], xRange };
}

let plots: uPlot[] = [];
afterEach(() => {
  plots.forEach((u) => u.destroy());
  plots = [];
});
beforeAll(loadAxisExtras);

describe("x-break panels with a Y break", () => {
  it("share the broken axis' range over all panels, and place a value at one height", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const breaks: [number, number][] = [[15, 995]];
    plots = renderBreakPanels(host, {
      panels: [panel([0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5], [0, 5]), panel([15, 16, 17, 18, 19, 20], [1015, 1016, 1017, 1018, 1019, 1020], [15, 20])],
      seriesLabels: {}, seriesStyles: {}, hiddenChannels: [], syncKey: "xy-break", box: { w: 800, h: 300 },
      yAuto: true,
      cell: { xScale: "linear", yScale: "linear", yLim: [0, 1020], tool: "zoom", onReadout: vi.fn(), yFmt: { mode: "auto", digits: 2, breaks } },
    } as Parameters<typeof renderBreakPanels>[1]);
    await new Promise((r) => setTimeout(r, 0));
    const want = breakAutoRange(0, 1020, breaks);
    for (const u of plots) expect([u.scales.y.min, u.scales.y.max]).toEqual(want);
    const fwd = plots.map((u) => (u.scales.y as uPlot.Scale & { fwd?: (v: number) => number }).fwd?.(1000));
    expect(fwd[0]).toBeDefined();
    expect(fwd[1]).toBe(fwd[0]);
  });
});
