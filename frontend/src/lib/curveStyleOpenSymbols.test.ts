// Gap audit 2 #6: open (hollow) symbols and error-bar styling (cap size, line
// width, colour), on the canvas and in the export request — one style field
// each, read by both sides, so screen and PDF cannot disagree.

import { describe, expect, it } from "vitest";

import { buildColorByColumns, paintColorPoint } from "./colorscatter";
import { buildExportStyles } from "./exportStyles";
import { seriesStyleFromExport } from "./graphFormat";
import { seriesPoints } from "./markers";
import type { PlotPayload } from "./plotdata";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import type { DataStruct, SeriesStyle } from "./types";
import { ERROR_CAP_HALF_PX, styleErrorDraw } from "./uplotErrorRange";
import { buildSeriesDefs } from "./uplotSeries";

const COLORS = { accentColor: "#00f", inkColor: "#fff", inkDimColor: "#888", isDarkBg: true };
const PAYLOAD: PlotPayload = {
  data: [[0, 1, 2], [1, 2, 3]],
  series: [{ label: "y", unit: "" }],
  xLabel: "x",
  xUnit: "",
};

describe("open (hollow) symbols", () => {
  it("a hollow marker paints no interior, circle and closed glyph alike", () => {
    expect(seriesPoints({ marker: true, markerFill: "hollow" }, "Line", "#f00").fill).toBe("transparent");
    const sq = seriesPoints({ marker: true, markerShape: "square", markerFill: "hollow" }, "Line", "#f00");
    expect(sq.fill).toBe("transparent");
    expect(sq.stroke).toBe("#f00");
  });

  it("a solid marker fills the circle with the series colour; unset keeps today's look", () => {
    expect(seriesPoints({ marker: true, markerFill: "solid" }, "Line", "#f00").fill).toBe("#f00");
    expect(seriesPoints({ marker: true }, "Line", "#f00").fill).toBeUndefined();
    expect(seriesPoints({ marker: true, markerShape: "square" }, "Line", "#f00").fill).toBe("#f00");
  });

  it("a hollow colour-mapped point is stroked, not filled", () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, {
      get: (_t, k) => (typeof k === "string" && ["beginPath", "arc", "fill", "stroke", "moveTo", "lineTo", "closePath"].includes(k)
        ? () => calls.push(k) : undefined),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    paintColorPoint(ctx, 5, 5, 2, "rgb(1, 2, 3)", "circle", true);
    expect(calls).toEqual(["beginPath", "arc", "stroke"]);
  });

  it("buildColorByColumns carries the series' hollow fill to the scatter spec", () => {
    const ds: DataStruct = { time: [0, 1], values: [[1, 5], [2, 6]], labels: ["a", "z"], units: ["", ""], metadata: {} };
    const specs = buildColorByColumns(ds, [0], { 0: { colorBy: 1, markerFill: "hollow" } });
    expect(specs.get(1)?.hollow).toBe(true);
  });

  it("the export request and the persisted publication style carry marker_fill", () => {
    const [spec] = buildExportStyles([0], { 0: { marker: true, markerFill: "hollow" } });
    expect(spec?.marker_fill).toBe("hollow");
    // A default-trace marker (no explicit `marker`) is hollow on the canvas
    // too, so the wire carries it either way.
    expect(buildExportStyles([0], { 0: { markerFill: "hollow" } })[0]?.marker_fill).toBe("hollow");
    expect(sanitizeExportSeriesStyles([{ marker_fill: "hollow" }, { marker_fill: "bogus" }])).toEqual([
      { marker_fill: "hollow" }, null,
    ]);
    expect(seriesStyleFromExport({ marker_fill: "hollow" })).toEqual({ markerFill: "hollow" });
  });
});

describe("error-bar styling", () => {
  const style: SeriesStyle = { errorBar: { cap: 4, width: 2, color: "#3388ff" } };

  it("rides on the uPlot series for the error plugins to read", () => {
    const { series } = buildSeriesDefs(PAYLOAD, { seriesStyles: [style] }, ["y"], true, COLORS);
    expect((series[1] as { qzErr?: unknown }).qzErr).toEqual({ cap: 4, width: 2, color: "#3388ff" });
    const plain = buildSeriesDefs(PAYLOAD, { seriesStyles: [{}] }, ["y"], true, COLORS);
    expect((plain.series[1] as { qzErr?: unknown }).qzErr).toBeUndefined();
  });

  it("the draw sets colour and width and returns the cap half-width; unset keeps the defaults", () => {
    const ctx = { strokeStyle: "", lineWidth: 1 } as unknown as CanvasRenderingContext2D;
    const u = { ctx, series: [{}, { stroke: () => "#f00", qzErr: { cap: 3, width: 2, color: "#0f0" } }, { stroke: () => "#00f" }] };
    expect(styleErrorDraw(u as never, 1, "#888", ERROR_CAP_HALF_PX)).toBeCloseTo(4); // 3 pt = 4 px
    expect(ctx.strokeStyle).toBe("#0f0");
    expect(ctx.lineWidth).toBe(2);
    expect(styleErrorDraw(u as never, 2, "#888", ERROR_CAP_HALF_PX)).toBe(ERROR_CAP_HALF_PX);
    expect(ctx.strokeStyle).toBe("#00f");
    expect(ctx.lineWidth).toBe(1);
    // cap 0 = no caps
    u.series[1].qzErr = { cap: 0, width: 2, color: "#0f0" };
    expect(styleErrorDraw(u as never, 1, "#888", ERROR_CAP_HALF_PX)).toBe(0);
  });

  it("the export request carries error_cap / error_width / error_color (hex)", () => {
    const [spec] = buildExportStyles([0], { 0: style });
    expect(spec).toMatchObject({ error_cap: 4, error_width: 2, error_color: "#3388ff" });
    expect(sanitizeExportSeriesStyles([{ error_cap: 4, error_width: 2, error_color: "#3388ff" }])).toEqual([
      { error_cap: 4, error_width: 2, error_color: "#3388ff" },
    ]);
    expect(sanitizeExportSeriesStyles([{ error_cap: -1, error_width: "x" }])).toEqual([null]);
    expect(seriesStyleFromExport({ error_cap: 4, error_width: 2, error_color: "#3388ff" })).toEqual({
      errorBar: { cap: 4, width: 2, color: "#3388ff" },
    });
  });
});
