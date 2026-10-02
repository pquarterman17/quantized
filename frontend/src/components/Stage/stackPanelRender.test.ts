// The plain per-channel stack lays its panels out so every plot AREA gets the
// same height. Each panel used to keep the full x-axis band (tick-label row +
// title band) with blank labels, so an 8-channel SIMS stack spent most of each
// ~80 px panel on empty axis space and drew ~16 px plots.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: { height: number; axes: { size?: unknown; label?: unknown; labelSize?: unknown }[] } }[] = [];
  class MockUPlot {
    height: number;
    constructor(opts: { height: number; axes: [] }) {
      this.height = opts.height;
      created.push({ opts });
    }
    setSize({ height }: { height: number }): void {
      this.height = height;
    }
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

import type { PlotPayload } from "../../lib/plotdata";
import { renderStackPanels, resizeStackPanels, type StackPanelsArgs } from "./stackPanelRender";

const panel: PlotPayload = {
  data: [[0, 1, 2], [1, 2, 3]] as PlotPayload["data"],
  series: [{ label: "H", unit: "atoms/cc" }],
  xLabel: "Depth",
  xUnit: "um",
};

const args = (n: number, h: number): StackPanelsArgs => ({
  panels: new Array(n).fill(panel),
  seriesLabels: [],
  seriesStyles: [],
  errorBars: [],
  syncKey: "k",
  onSetScale: () => {},
  box: { w: 600, h },
  cell: { xScale: "linear", yScale: "log", tool: "zoom", onReadout: () => {} },
});

/** The x-axis band a panel reserves below its plot area. */
const band = ({ opts }: (typeof created)[number]) => {
  const x = opts.axes[0];
  return Number(x.size) + (x.label != null ? Number(x.labelSize) : 0);
};

beforeEach(() => {
  created.length = 0;
});

describe("renderStackPanels", () => {
  it("gives every panel the same plot-area height", () => {
    const host = document.createElement("div");
    renderStackPanels(host, args(8, 720));
    const areas = created.map((c) => c.opts.height - band(c));
    expect(new Set(areas).size).toBe(1);
    expect(areas[0]).toBeGreaterThan(55);
  });

  it("keeps only a tick-mark band on the panels above the bottom one", () => {
    renderStackPanels(document.createElement("div"), args(3, 400));
    expect(created.slice(0, -1).every((c) => band(c) <= 10)).toBe(true);
    expect(band(created[2])).toBeGreaterThan(40);
  });

  it("re-fits to the same rule on resize", () => {
    const host = document.createElement("div");
    const plots = renderStackPanels(host, args(4, 400));
    Object.defineProperty(host, "clientHeight", { value: 800 });
    resizeStackPanels(host, plots, 600);
    const heights = plots.map((u) => u.height);
    const areas = heights.map((hh, i) => hh - band(created[i]));
    expect(new Set(areas).size).toBe(1);
    expect(heights.reduce((a, b) => a + b, 0) + 3 * 8).toBeLessThanOrEqual(800);
  });
});
