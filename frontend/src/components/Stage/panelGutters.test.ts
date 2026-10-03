// Plot audit round 3: stacked panels share one x axis, but each panel sized
// its y-tick gutter from its OWN labels, so a panel reading "-0.0025" started
// its plot area ~16 px right of one reading "0" and the x ticks no longer lined
// up down the stack (7-file VSM overlay, stacked). Every panel now takes the
// widest gutter of the stack, on build and on resize — and so does every cell
// of a facet grid, whose columns share an x axis the same way.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Axis = { side?: number; show?: boolean; size?: unknown; _size?: number };

const { created, MockUPlot, tickLabels } = vi.hoisted(() => {
  // Per-panel drawn y tick labels, by construction order.
  const tickLabels: string[][] = [];
  const created: InstanceType<typeof MockUPlot>[] = [];
  class MockUPlot {
    width: number;
    height: number;
    axes: Axis[];
    ctx = { font: "", measureText: (t: string) => ({ width: t.length * 7 }) };
    private labels: string[];
    constructor(opts: { width: number; height: number; axes: Axis[] }) {
      this.width = opts.width;
      this.height = opts.height;
      this.axes = opts.axes.map((a) => ({ ...a }));
      this.labels = tickLabels[created.length] ?? ["0"];
      created.push(this);
      this.layout();
    }
    private layout(): void {
      this.axes.forEach((a, k) => {
        if (k === 0) return;
        a._size = typeof a.size === "function" ? (a.size as (...x: unknown[]) => number)(this, this.labels, k, 1) : Number(a.size ?? 50);
      });
    }
    setSize({ width, height }: { width: number; height: number }): void {
      this.width = width;
      this.height = height;
      this.layout();
    }
  }
  return { created, MockUPlot, tickLabels };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

import type { PlotPayload } from "../../lib/plotdata";
import { renderFacetGrid, resizeFacetGrid } from "./facetGridRender";
import { renderStackPanels, resizeStackPanels, type StackPanelsArgs } from "./stackPanelRender";

const panel: PlotPayload = {
  data: [[0, 1, 2], [1, 2, 3]] as PlotPayload["data"],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "Field",
  xUnit: "Oe",
};

const args = (n: number): StackPanelsArgs => ({
  panels: new Array(n).fill(panel),
  seriesLabels: [],
  seriesStyles: [],
  errorBars: [],
  syncKey: "k",
  onSetScale: () => {},
  box: { w: 600, h: 600 },
  cell: { xScale: "linear", yScale: "linear", tool: "zoom", onReadout: () => {} },
});

const gutters = () => created.map((u) => u.axes[1]._size);

beforeEach(() => {
  created.length = 0;
  tickLabels.length = 0;
});

describe("stacked panels' y gutters", () => {
  it("take the stack's widest, so every plot area starts at the same x", () => {
    tickLabels.push(["0"], ["-0.0025000000", "0", "0.0025000000"], ["0"]);
    const host = document.createElement("div");
    const plots = renderStackPanels(host, args(3));
    expect(new Set(gutters()).size).toBe(1);
    // ...the widest panel's own, not some fixed floor.
    const widest = Math.max(...gutters().map(Number));
    expect(widest).toBeGreaterThan(60); // a lone "0" panel's own gutter is the 60 px floor

    // A resize re-measures: the stack follows its new widest label.
    tickLabels.length = 0;
    expect(plots).toHaveLength(3);
    resizeStackPanels(host, plots, 600);
    expect(new Set(gutters()).size).toBe(1);
  });
});

describe("facet cells' y gutters", () => {
  it("take the grid's widest, so a column's x ticks line up row to row", () => {
    tickLabels.push(["0"], ["-0.0025000000"], ["0"], ["1"]);
    const host = document.createElement("div");
    const grid = { rows: 2, cols: 2 };
    const panels = [0, 1, 2, 3].map((i) => ({ label: `L${i}`, payload: panel, channels: [1] }));
    const plots = renderFacetGrid(host, {
      panels, seriesLabels: {}, seriesStyles: {}, grid, gap: 8, syncKey: "k", onSetScale: () => {},
      box: { w: 600, h: 400 }, cell: { xScale: "linear", yScale: "linear", tool: "zoom", onReadout: () => {} },
    });
    expect(new Set(gutters()).size).toBe(1);
    resizeFacetGrid(host, plots, grid, 8, { w: 600, h: 400 });
    expect(new Set(gutters()).size).toBe(1);
  });
});
