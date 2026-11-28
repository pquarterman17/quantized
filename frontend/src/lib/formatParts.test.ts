// Plan item 42: every format field has exactly one owner, and a part applies only what it owns.

import { describe, expect, it } from "vitest";

import { AXIS_FORMAT, SERIES_STYLE } from "./workspaceForwardCompat";
import {
  AXIS_FMT_OWNER, AXIS_LABEL_STYLE_OWNER, DEFAULT_PARTS, FORMAT_PARTS, SERIES_OWNER, VIEW_OWNER, axisFmtKeys, sanitizeParts, seriesKeys, wholeViewKeys,
  type FormatPartId,
} from "./formatParts";
import { formatPartsPatch } from "./formatPartsPatch";
import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat } from "./graphFormat";
import { captureExtras } from "./graphFormatExtras";
import { defaultPlotView, type PlotView } from "./plotview";

const ids = FORMAT_PARTS.map((p) => p.id);

describe("part ownership tables", () => {
  it("VIEW_OWNER names exactly the PlotView fields", () => {
    expect(Object.keys(VIEW_OWNER).sort()).toEqual(Object.keys(defaultPlotView()).sort());
  });
  it("the AxisFormat and SeriesStyle tables name exactly the fields the workspace classifier knows", () => {
    expect(Object.keys(AXIS_FMT_OWNER).sort()).toEqual(Object.keys(AXIS_FORMAT).sort());
    expect(Object.keys(SERIES_OWNER).sort()).toEqual(Object.keys(SERIES_STYLE).sort());
    expect(Object.keys(AXIS_LABEL_STYLE_OWNER).sort()).toEqual(["bold", "italic", "size"]);
  });
  it("every owner is a real part, and every part owns something", () => {
    const owners = new Set<string>([
      ...Object.values(VIEW_OWNER), ...Object.values(SERIES_OWNER), ...Object.values(AXIS_FMT_OWNER), "fontTitles", "colorBackground",
      "scalesX", "scalesY", "scalesY2",
    ]);
    for (const o of owners) expect(["never", "series", "axisFmt", "scales", ...ids]).toContain(o);
    for (const id of ids) expect(owners.has(id), id).toBe(true);
  });
  it("every field a captured format carries has an owner that is not 'never'", () => {
    const f = { ...captureGraphFormat({ ...defaultPlotView(), yAxes: [], yAxisOf: {} }, []), extras: captureExtras(defaultPlotView(), "theme") };
    const carried = [...Object.keys(f), ...Object.keys(f.extras)].filter((k) => !["version", "series", "extras", "bg", "seriesAxis"].includes(k));
    for (const k of carried) expect(VIEW_OWNER[k as keyof PlotView], k).toBeDefined();
    for (const k of carried) expect(VIEW_OWNER[k as keyof PlotView], k).not.toBe("never");
  });
  it("data bindings, text and decorations are never owned", () => {
    for (const k of ["xKey", "yKeys", "groupKey", "facetKey", "plotTitle", "xAxisLabel", "refLines", "annotations", "seriesLabels", "hiddenChannels", "seriesOrder"] as const) {
      expect(VIEW_OWNER[k]).toBe("never");
      expect(wholeViewKeys(new Set(ids))).not.toContain(k);
    }
    for (const k of ["colorBy", "sizeBy", "colormap"] as const) expect(seriesKeys(new Set(ids))).not.toContain(k);
    expect(axisFmtKeys(new Set(ids), "y")).not.toContain("breaks");
  });
  it("opt-in parts are not in 'everything'", () => {
    expect(DEFAULT_PARTS).not.toContain("limitsX");
    expect(DEFAULT_PARTS).not.toContain("colorBackground");
    expect(DEFAULT_PARTS).toContain("fontTicks");
  });
  it("sanitizeParts keeps valid ids in registry order and nothing else", () => {
    expect(sanitizeParts(["scalesX", "bogus", "fontTicks", "scalesX"])).toEqual(["fontTicks", "scalesX"]);
    expect(sanitizeParts(["bogus"])).toBeNull();
    expect(sanitizeParts("fontTicks")).toBeNull();
  });
});

/** A heavily styled source graph and a differently styled target, both with two plotted curves 0 and 1. */
function source(): PlotView {
  return {
    ...defaultPlotView(),
    xScale: "log", yScale: "log", showGrid: false, showAxisBox: false, plotTemplate: "aps", legendPos: "sw", showLegend: false,
    xFmt: { mode: "sci", digits: 3, size: 14, grid: { major: true, minor: true, color: "#123456" } },
    yFmt: { mode: "fixed", digits: 1, size: 9, minor: 4 },
    axisLabelStyles: { x: { size: 18, bold: true } },
    xLim: [1, 100], yLim: [0, 5], xStep: 10,
    seriesStyles: {
      0: { color: "#ff0000", width: 3, line: "dashed", marker: true, markerShape: "diamond", markerSize: 9 },
      1: { color: "#00ff00", width: 1, marker: true, markerShape: "star", fill: "under" },
    },
  };
}
function target(): PlotView {
  return {
    ...defaultPlotView(),
    xFmt: { mode: "auto", digits: 2, breaks: [[1, 2]] },
    seriesStyles: { 0: { color: "#0000ff", width: 1 }, 1: { color: "#ababab", markerShape: "square", marker: true } },
    xKey: 3, yKeys: [0, 1], plotTitle: "keep me",
  };
}
const fmt = () => sanitizeGraphFormat({ ...captureGraphFormat(source(), [0, 1]), extras: captureExtras(source(), "dark") })!;

function changed(before: PlotView, patch: Partial<PlotView>): string[] {
  return Object.keys(patch).filter((k) => JSON.stringify(patch[k as keyof PlotView]) !== JSON.stringify(before[k as keyof PlotView])).sort();
}

describe("formatPartsPatch", () => {
  const t = target();
  const run = (parts: FormatPartId[]) => formatPartsPatch(fmt(), new Set(parts), [0, 1], t);

  it("fonts and X/Y scales change only their own fields", () => {
    const r = run(["fontTicks", "fontTitles", "scalesX", "scalesY"]);
    expect(changed(t, r.patch)).toEqual(["axisLabelStyles", "xFmt", "xScale", "yFmt", "yScale"]);
    expect(r.patch.xFmt).toEqual({ mode: "sci", digits: 3, size: 14, breaks: [[1, 2]] }); // grid colour not ticked; own breaks kept
    expect(r.patch.yFmt).toMatchObject({ mode: "fixed", digits: 1, size: 9, minor: 4 });
    expect(r.patch.xFmt).not.toHaveProperty("grid");
    expect(r.patch.seriesStyles).toBeUndefined();
    expect(r.bg).toBeUndefined();
  });

  it("tick-label size alone changes only the size key of each tick format", () => {
    const r = run(["fontTicks"]);
    expect(r.patch.xFmt).toEqual({ mode: "auto", digits: 2, size: 14, breaks: [[1, 2]] });
    expect(Object.keys(r.patch).sort()).toEqual(["xFmt", "yFmt"]);
  });

  it("symbols replace marker fields only; colours and lines stay", () => {
    const r = run(["symbols"]);
    expect(r.patch.seriesStyles).toEqual({
      0: { color: "#0000ff", width: 1, marker: true, markerShape: "diamond", markerSize: 9 },
      1: { color: "#ababab", marker: true, markerShape: "star" },
    });
  });

  it("colours, lines and curve options each take only their keys", () => {
    expect(run(["colorCurves"]).patch.seriesStyles).toEqual({ 0: { color: "#ff0000", width: 1 }, 1: { color: "#00ff00", markerShape: "square", marker: true } });
    expect(run(["lines"]).patch.seriesStyles).toEqual({ 0: { color: "#0000ff", width: 3, line: "dashed" }, 1: { color: "#ababab", width: 1, markerShape: "square", marker: true } });
    expect(run(["curveOptions"]).patch.seriesStyles?.[1]).toMatchObject({ fill: "under" });
  });

  it("grid, legend, frame and background parts", () => {
    expect(run(["colorGrid"]).patch).toMatchObject({ showGrid: false });
    expect(run(["colorGrid"]).patch.xFmt).toMatchObject({ grid: { color: "#123456" } });
    expect(Object.keys(run(["legend"]).patch).sort()).toEqual(["legendFrameXY", "legendPos", "legendSize", "legendStatic", "legendXY", "showLegend"]);
    expect(Object.keys(run(["frame"]).patch).sort()).toEqual(["plotTemplate", "showAxisBox"]);
    expect(run(["colorBackground"]).bg).toBe("dark");
    expect(run(["colorBackground"]).patch).toEqual({});
  });

  it("limits are opt-in parts: ticked per axis, never in 'everything'", () => {
    expect(run(["limitsX"]).patch).toEqual({ xLim: [1, 100], xStep: 10 });
    expect(run(["limitsY"]).patch).toEqual({ yLim: [0, 5], yStep: null });
    const all = formatPartsPatch(fmt(), new Set(DEFAULT_PARTS), [0, 1], t).patch;
    expect(all).not.toHaveProperty("xLim");
    expect(all).not.toHaveProperty("yStep");
  });

  it("a format captured without extras never touches limits, legend placement or background", () => {
    const bare = captureGraphFormat(source(), [0, 1]);
    const r = formatPartsPatch(bare, new Set(ids), [0, 1], t);
    expect(r.patch).not.toHaveProperty("xLim");
    expect(r.patch).not.toHaveProperty("legendXY");
    expect(r.bg).toBeUndefined();
  });

  it("never touches data, titles or bindings, whatever is ticked", () => {
    const r = run(ids);
    for (const k of ["xKey", "yKeys", "plotTitle", "xAxisLabel", "refLines", "annotations", "hiddenChannels"]) expect(r.patch).not.toHaveProperty(k);
  });

  it("every default part ticked equals the whole-format patch on every field the whole patch writes", () => {
    const whole = graphFormatPatch(fmt(), [0, 1], t.seriesStyles, t);
    const parts = formatPartsPatch(fmt(), new Set(DEFAULT_PARTS), [0, 1], t).patch;
    // A Y2 that inherits Y on both sides needs no write (the whole patch writes null over null).
    for (const k of Object.keys(whole) as (keyof PlotView)[]) expect(k in parts ? parts[k] : k === "y2Fmt" ? null : undefined, k).toEqual(whole[k]);
  });

  it("curve counts: styles map by position and STOP at the shorter side", () => {
    const three = { ...t, seriesStyles: { ...t.seriesStyles, 2: { color: "#222222" } } };
    const r = formatPartsPatch(fmt(), new Set<FormatPartId>(["colorCurves"]), [0, 1, 2], three);
    expect(r.styled).toBe(2);
    expect(r.unmapped).toBe(1);
    expect(r.patch.seriesStyles?.[2]).toEqual({ color: "#222222" }); // past the format's last curve: its own style
    const one = formatPartsPatch(fmt(), new Set<FormatPartId>(["colorCurves"]), [0], t);
    expect(one.styled).toBe(1);
    expect(one.patch.seriesStyles?.[1]).toEqual(t.seriesStyles[1]); // a format curve with no target curve is unused
  });

  it("a format curve with no style clears the owned keys on the target curve", () => {
    const f = { ...fmt(), series: [null, { color: "#00ff00" }] };
    const r = formatPartsPatch(f, new Set<FormatPartId>(["colorCurves"]), [0, 1], t);
    expect(r.patch.seriesStyles?.[0]).toEqual({ width: 1 });
  });
});
