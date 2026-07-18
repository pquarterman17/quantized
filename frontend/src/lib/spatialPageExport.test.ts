import { describe, expect, it } from "vitest";

import type { SpatialPanel } from "./multipanel";
import { defaultPageSetup } from "./pagesetup";
import { buildSpatialPageRequest, canExportSpatialPage } from "./spatialPageExport";
import type { DataStruct } from "./types";

function panel(overrides: Partial<SpatialPanel> = {}): SpatialPanel {
  return {
    datasetId: "ds1",
    xKey: 0,
    yKeys: [1, 2],
    xLim: [0, 1],
    yLim: [0, 1],
    xLog: false,
    yLog: false,
    row: 0,
    col: 0,
    pageRect: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
    ...overrides,
  };
}

function ds(): DataStruct {
  return {
    time: [0, 1, 2],
    values: [
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
    ],
    labels: ["a", "b", "c"],
    units: ["", "", ""],
    metadata: {},
  };
}

describe("canExportSpatialPage", () => {
  it("false with no panels, no page model, or a panel missing pageRect", () => {
    const ps = defaultPageSetup();
    expect(canExportSpatialPage(null, ps)).toBe(false);
    expect(canExportSpatialPage([], ps)).toBe(false);
    expect(canExportSpatialPage([panel()], null)).toBe(false);
    expect(canExportSpatialPage([panel({ pageRect: undefined })], ps)).toBe(false);
  });

  it("true when every panel has a valid, in-bounds pageRect and a page model exists", () => {
    expect(canExportSpatialPage([panel(), panel({ col: 1 })], defaultPageSetup())).toBe(true);
  });
});

describe("buildSpatialPageRequest", () => {
  it("passes each panel's pageRect through untouched as [x, y, w, h]", () => {
    const p = panel({ pageRect: { left: 0.05, top: 0.15, width: 0.4, height: 0.5 } });
    const spec = buildSpatialPageRequest([p], new Map([["ds1", ds()]]), defaultPageSetup());
    expect(spec).not.toBeNull();
    expect(spec!.panels[0].page_rect).toEqual([0.05, 0.15, 0.4, 0.5]);
  });

  it("never sends a margins override -- the pageRect already embeds the true page margins", () => {
    const spec = buildSpatialPageRequest([panel()], new Map([["ds1", ds()]]), defaultPageSetup());
    const overrides = spec!.panels[0].figure.overrides;
    expect(overrides == null || !("margins" in overrides)).toBe(true);
  });

  it('defaults label_format to "none" (an Origin page recreation, not a lettered figure)', () => {
    const spec = buildSpatialPageRequest([panel()], new Map([["ds1", ds()]]), defaultPageSetup());
    expect(spec!.label_format).toBe("none");
  });

  it("sizes the page from PageSetup's own width/height in inches", () => {
    const ps = { ...defaultPageSetup(), width: 8, height: 6 };
    const spec = buildSpatialPageRequest([panel()], new Map([["ds1", ds()]]), ps);
    expect(spec!.width_in).toBe(8);
    expect(spec!.height_in).toBe(6);
  });

  it("drops hidden channels and carries this panel's own axis state into the figure payload", () => {
    const dataset = ds();
    const p = panel({ yKeys: [1, 2], hiddenChannels: [2], xLog: true, yLog: false, xStep: 0.5 });
    const spec = buildSpatialPageRequest([p], new Map([["ds1", dataset]]), defaultPageSetup());
    const fig = spec!.panels[0].figure;
    expect(fig.dataset).toBe(dataset);
    expect(fig.y_keys).toEqual([1]);
    expect(fig.x_log).toBe(true);
    expect(fig.y_log).toBe(false);
    expect(fig.x_step).toBe(0.5);
  });

  it("preserves only decoded partial legend entries and never mutates the workbook labels", () => {
    const dataset = ds();
    const p = panel({
      seriesLabels: { 1: "Measured" },
      legendTitle: "SLD",
      legendFrameXY: [0.2, 0.3],
    });
    const fig = buildSpatialPageRequest(
      [p],
      new Map([["ds1", dataset]]),
      defaultPageSetup(),
    )!.panels[0].figure;
    expect(fig.dataset).not.toBe(dataset);
    expect(fig.dataset.labels).toEqual(["a", "Measured", "_nolegend_"]);
    expect(dataset.labels).toEqual(["a", "b", "c"]);
    expect(fig.overrides?.legend).toEqual({
      show: true,
      loc: "axes",
      anchor: [0.2, 0.3],
      title: "SLD",
    });
  });

  it("does not invent a legend when the panel has no decoded legend content", () => {
    const fig = buildSpatialPageRequest(
      [panel()],
      new Map([["ds1", ds()]]),
      defaultPageSetup(),
    )!.panels[0].figure;
    expect(fig.overrides?.legend).toEqual({ show: false });
  });

  it("carries primary annotations but drops y2 annotations the page endpoint cannot place", () => {
    const fig = buildSpatialPageRequest(
      [panel({
        annotations: [
          { id: "a1", x: 0.2, y: 0.4, text: "primary" },
          { id: "a2", x: 0.3, y: 0.5, text: "secondary", axis: 1 },
        ],
      })],
      new Map([["ds1", ds()]]),
      defaultPageSetup(),
    )!.panels[0].figure;
    expect(fig.overrides?.annotations).toEqual([{ x: 0.2, y: 0.4, text: "primary" }]);
  });

  it("omits y2 curves instead of flattening them onto the primary export axis", () => {
    const fig = buildSpatialPageRequest(
      [panel({ yKeys: [1, 2], y2Keys: [2] })],
      new Map([["ds1", ds()]]),
      defaultPageSetup(),
    )!.panels[0].figure;
    expect(fig.y_keys).toEqual([1]);
  });

  it("fails closed when a panel has no representable primary-axis curve", () => {
    const spec = buildSpatialPageRequest(
      [panel({ yKeys: [1], y2Keys: [1] })],
      new Map([["ds1", ds()]]),
      defaultPageSetup(),
    );
    expect(spec).toBeNull();
  });

  it("carries page appearance, panel limits, and log minor-tick state", () => {
    const fig = buildSpatialPageRequest(
      [panel({ xLim: [2, 8], yLim: [0.01, 10], yLog: true })],
      new Map([["ds1", ds()]]),
      defaultPageSetup(),
      {
        xFmt: { mode: "eng", digits: 2 },
        yFmt: { mode: "sci", digits: 1 },
        showGrid: false,
        showAxisBox: true,
      },
    )!.panels[0].figure;
    expect(fig.x_fmt).toEqual({ mode: "eng", digits: 2 });
    expect(fig.y_fmt).toEqual({ mode: "sci", digits: 1 });
    expect(fig.overrides).toMatchObject({
      x_lim: [2, 8],
      y_lim: [0.01, 10],
      grid: false,
      spines: { top: true, right: true },
      ticks: { minor: true },
    });
  });

  it("an explicitly-blank decoded axis title (null) exports as blank, not auto-derived", () => {
    const p = panel({ xAxisLabel: null });
    const spec = buildSpatialPageRequest([p], new Map([["ds1", ds()]]), defaultPageSetup());
    expect(spec!.panels[0].figure.x_label).toBe("");
  });

  it("null when any panel lacks a valid pageRect (fail-closed, no grid fallback)", () => {
    const spec = buildSpatialPageRequest(
      [panel(), panel({ col: 1, pageRect: undefined })],
      new Map([["ds1", ds()]]),
      defaultPageSetup(),
    );
    expect(spec).toBeNull();
  });

  it("null when a pageRect is out of the [0,1] page bounds", () => {
    const p = panel({ pageRect: { left: 0.8, top: 0.1, width: 0.5, height: 0.4 } });
    expect(buildSpatialPageRequest([p], new Map([["ds1", ds()]]), defaultPageSetup())).toBeNull();
  });

  it("null when there is no page model", () => {
    expect(buildSpatialPageRequest([panel()], new Map([["ds1", ds()]]), null)).toBeNull();
  });

  it("null with no panels", () => {
    expect(buildSpatialPageRequest([], new Map([["ds1", ds()]]), defaultPageSetup())).toBeNull();
  });

  it("null when a panel's dataset isn't in the resolved map (dead source)", () => {
    expect(buildSpatialPageRequest([panel()], new Map(), defaultPageSetup())).toBeNull();
  });
});
