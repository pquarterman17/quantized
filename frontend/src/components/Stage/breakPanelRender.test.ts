// Break panels each show their OWN x-slice. They used to share the stack's
// x-zoom sync hook, which was harmless only while a fixed xLim was a static
// range pair that uPlot re-applied on every setScale. Once a fixed limit keeps
// explicit bounds (lib/uplotXRange.fixedXRange — so a live zoom sticks), that
// sync copied the first panel's x domain onto the next one and the right-hand
// panel showed the left-hand slice (the regression-matrix-screen "break" e2e).
// Real uPlot; jsdom lacks `matchMedia` and `Path2D`, stubbed before the import.
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
import { renderBreakPanels } from "./breakPanelRender";

function panel(xs: number[], xRange: [number, number]): BreakPanel {
  const payload: PlotPayload = {
    data: [xs, xs.map((x) => x * 2)] as PlotPayload["data"],
    series: [{ label: "y", unit: "" }],
    xLabel: "x",
    xUnit: "",
  };
  return { payload, channels: [0], xRange };
}

let plots: uPlot[] = [];
afterEach(() => {
  plots.forEach((u) => u.destroy());
  plots = [];
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("renderBreakPanels", () => {
  it("keeps each panel on its own x-slice", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    plots = renderBreakPanels(host, {
      panels: [panel([0, 1, 2], [0, 2]), panel([3, 4, 5], [3, 5])],
      seriesLabels: {},
      seriesStyles: {},
      hiddenChannels: [],
      syncKey: "break-test",
      box: { w: 800, h: 300 },
      cell: { xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn() },
    });
    await settle();
    expect(plots.map((u) => [u.scales.x.min, u.scales.x.max])).toEqual([[0, 2], [3, 5]]);
  });

  // Plot audit round 3: an x-break keeps ONE y scale. A box zoom or wheel on
  // one panel rescaled y there alone, so one break read two y ranges.
  it("moves every panel's y with a y zoom on one, and leaves each panel's own x alone", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    plots = renderBreakPanels(host, {
      panels: [panel([0, 1, 2], [0, 2]), panel([3, 4, 5], [3, 5])],
      seriesLabels: {}, seriesStyles: {}, hiddenChannels: [], syncKey: "break-test-y", box: { w: 800, h: 300 },
      cell: { xScale: "linear", yScale: "linear", yLim: [0, 10], tool: "zoom", onReadout: vi.fn() },
    });
    await settle();
    plots[0].setScale("y", { min: 1, max: 3 });
    await settle();
    expect([plots[1].scales.y.min, plots[1].scales.y.max]).toEqual([1, 3]);
    expect(plots.map((u) => [u.scales.x.min, u.scales.x.max])).toEqual([[0, 2], [3, 5]]);
  });
});
