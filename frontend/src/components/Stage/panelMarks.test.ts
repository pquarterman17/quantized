// Which of the data-driven marks each multi-panel arrangement draws on screen
// (the export of the same arrangement draws the same or warns:
// tests/test_calc_figure_marks_paths.py). Facet grids draw none of spline /
// drop lines / size-by; stacked cells draw spline and drop lines (size-by is
// stripped); a multi-panel cell likewise (`lib/multipanel.spatialCellStyling`).
import { beforeAll, describe, expect, it, vi } from "vitest";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: { series: { paths?: unknown }[]; plugins?: unknown[] } }[] = [];
  class MockUPlot {
    constructor(opts: { series: []; plugins?: [] }) {
      created.push({ opts });
    }
    setSize(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

import { spatialCellStyling } from "../../lib/multipanel";
import { ensureMarks, marks } from "../../lib/marksLoader";
import type { PlotPayload } from "../../lib/plotdata";
import type { SeriesStyle } from "../../lib/types";
import { renderFacetGrid, type FacetGridArgs } from "./facetGridRender";
import { renderStackPanels, type StackPanelsArgs } from "./stackPanelRender";

const payload: PlotPayload = {
  data: [[1, 2, 3, 4], [10, 20, 15, 30]] as PlotPayload["data"],
  series: [{ label: "M", unit: "" }],
  xLabel: "H",
  xUnit: "",
};
const MARKS: SeriesStyle = { connect: "spline", dropLines: "x", sizeBy: 1 };
const cell = { xScale: "linear", yScale: "linear", tool: "zoom", onReadout: () => {} } as const;
const pluginCount = () => created.at(-1)!.opts.plugins?.length ?? 0;

beforeAll(async () => {
  ensureMarks([MARKS]);
  await vi.waitFor(() => expect(marks()).not.toBeNull());
});

describe("marks per arrangement (once the lazy module has loaded)", () => {
  it("a facet grid draws none: no spline path, no drop-line plugin", () => {
    const grid = (style?: SeriesStyle): FacetGridArgs => ({
      panels: [{ label: "p", payload, channels: [0] }] as unknown as FacetGridArgs["panels"],
      seriesLabels: {}, seriesStyles: style ? { 0: style } : {}, grid: { rows: 1, cols: 1 }, gap: 4,
      syncKey: "k", onSetScale: (() => {}) as never, box: { w: 400, h: 300 }, cell,
    });
    renderFacetGrid(document.createElement("div"), grid());
    const baseline = pluginCount();
    renderFacetGrid(document.createElement("div"), grid(MARKS));
    expect(created.at(-1)!.opts.series[1].paths).toBeUndefined();
    expect(pluginCount()).toBe(baseline);
  });

  it("a stacked cell keeps the spline and the drop lines", () => {
    const args = (style?: SeriesStyle): StackPanelsArgs => ({
      panels: [payload], seriesLabels: [], seriesStyles: [style], errorBars: [], syncKey: "k",
      onSetScale: () => {}, box: { w: 400, h: 300 }, cell,
    });
    renderStackPanels(document.createElement("div"), args());
    const baseline = pluginCount();
    renderStackPanels(document.createElement("div"), args(MARKS));
    expect(created.at(-1)!.opts.series[1].paths).toBeTypeOf("function");
    expect(pluginCount()).toBe(baseline + 1);
  });

  it("a multi-panel cell's styles drop size-by only", () => {
    const { cellStyles } = spatialCellStyling(
      { yKeys: [0], hiddenChannels: [], seriesStyles: { 0: { ...MARKS, color: "#f00" } }, seriesLabels: {} } as never,
      false,
    );
    expect(cellStyles[0]).toMatchObject({ connect: "spline", dropLines: "x", color: "#f00" });
    expect(cellStyles[0]?.sizeBy).toBeUndefined();
  });
});
