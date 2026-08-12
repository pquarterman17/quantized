import { describe, expect, it } from "vitest";

import {
  figureDocPlotCompatibility,
  figureTransitionWarning,
  plotSpecPublicationCompatibility,
} from "./figureCompatibility";
import type { FigureDoc } from "./figuredoc";
import type { PlotSpec } from "./plotspec";

const spec = (over: Partial<PlotSpec> = {}): PlotSpec => ({
  version: 1,
  zones: {
    x: { datasetId: "d1", channel: 0 },
    y: [{ datasetId: "d1", channel: 1 }],
    group: null,
    facet: null,
    yErr: [],
    xErr: null,
  },
  mark: "line",
  ...over,
});

const doc = (config: Partial<FigureDoc["config"]> = {}): FigureDoc => ({
  id: "f1",
  name: "Figure",
  datasetId: "d1",
  live: true,
  config: {
    xKey: 0,
    yKeys: [1],
    xScale: "linear",
    yScale: "linear",
    title: "",
    xLabel: "",
    yLabel: "",
    style: "default",
    fmt: "pdf",
    dpi: 300,
    overrides: null,
    seriesStyles: null,
    ...config,
  },
});

describe("figure transition compatibility", () => {
  it("reports every known lossy PlotSpec field without blocking a supported XY plot", () => {
    const report = plotSpecPublicationCompatibility(spec({
      version: 2,
      display: { series: { 1: { hidden: true, markerShape: "square" } }, order: [1] },
      axes: { x: { step: 2, fmt: { mode: "fixed", digits: 1 } } },
      decor: {
        annotations: [{ id: "a", x: 1, y: 2, text: "note" }],
        shapes: [{ id: "s", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }],
        legend: { pos: "nw" },
      },
      page: { stack: true },
    }));

    expect(report.blocker).toBeNull();
    expect(report.losses).toEqual(expect.arrayContaining([
      "hidden-series state",
      "custom series order",
      "marker shapes",
      "axis tick spacing",
      "axis number formats",
      "annotations",
      "shapes",
      "legend placement and title",
      "page and panel settings",
    ]));
  });

  it("keeps unsupported PlotSpecs blocked rather than describing them as lossy", () => {
    const report = plotSpecPublicationCompatibility(spec({ mark: "box" }));
    expect(report.blocker).toContain("Publication Preview");
    expect(report.losses).toEqual([]);
  });

  // ORIGIN_GAP_PLAN #51 phase 3: error bars are NOT a loss when the wells are
  // set — plotSpecToFigureDoc threads them into FigureConfig.errors losslessly
  // (see plotSpecFigure.test.ts's "error wells" describe block), unlike
  // hidden-series/marker-shapes/etc. above, which genuinely have no
  // FigureConfig equivalent.
  it("never reports error bars as a loss, wells set or not", () => {
    const withWells = plotSpecPublicationCompatibility(spec({
      zones: {
        ...spec().zones,
        yErr: [{ datasetId: "d1", channel: 2 }],
        xErr: { datasetId: "d1", channel: 3 },
      },
    }));
    expect(withWells.blocker).toBeNull();
    expect(withWells.losses).not.toContain("error bars");
    expect(plotSpecPublicationCompatibility(spec()).losses).not.toContain("error bars");
  });

  it("line, scatter, AND step all open unblocked (GAP_PLOTTYPES)", () => {
    expect(plotSpecPublicationCompatibility(spec({ mark: "line" })).blocker).toBeNull();
    expect(plotSpecPublicationCompatibility(spec({ mark: "scatter" })).blocker).toBeNull();
    expect(plotSpecPublicationCompatibility(spec({ mark: "step", stepMode: "mid" })).blocker).toBeNull();
  });

  it("reports the FigureDoc fields omitted by the fresh-window bridge", () => {
    const report = figureDocPlotCompatibility(doc({
      groupCol: 2,
      style: "aps",
      seriesStyles: [{ color: "#123456" }],
      overrides: {
        x_lim: [0, 1],
        legend: { show: false },
        annotations: [{ x: 1, y: 2, text: "note" }],
        ref_lines: [{ axis: "x", value: 5 }],
        region_shades: [{ x1: 0, x2: 1, y1: 0, y2: 1, fill: "#112233" }],
        x_breaks: [[3, 4]],
        font_size: 12,
      },
    }));

    expect(report.blocker).toBeNull();
    expect(report.losses).toEqual(expect.arrayContaining([
      "grouped-series mapping",
      "series styles",
      "publication style preset",
      "manual axis ranges",
      "legend settings",
      "annotations",
      "reference lines",
      "region shades",
      "axis breaks",
      "publication fonts, ticks, frame, margins, or grid settings",
    ]));
    expect(figureTransitionWarning(report.losses)).toContain("will not transfer");
  });

  it("blocks frozen and missing-source FigureDocs", () => {
    expect(figureDocPlotCompatibility({ ...doc(), live: false }).blocker).not.toBeNull();
    expect(figureDocPlotCompatibility({ ...doc(), datasetId: null }).blocker).not.toBeNull();
  });
});
