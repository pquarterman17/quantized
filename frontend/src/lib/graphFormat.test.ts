// Figures-audit B2: the style-only graph format behind graph templates and
// Copy/Paste Format.

import { describe, expect, it } from "vitest";

import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat, seriesStyleFromExport } from "./graphFormat";
import { defaultPlotView } from "./plotview";

describe("graph format", () => {
  const source = {
    ...defaultPlotView(),
    yScale: "log" as const,
    showGrid: false,
    xFmt: { mode: "sci" as const, digits: 3 },
    seriesStyles: {
      4: { color: "#112233", width: 3, colorBy: 7, fill: { vs: 5 } },
      6: { marker: true, markerShape: "diamond" as const },
    },
  };

  it("captures style by plotted POSITION and drops every channel reference", () => {
    const format = captureGraphFormat(source, [4, 6]);
    expect(format.series).toEqual([{ color: "#112233", width: 3 }, { marker: true, markerShape: "diamond" }]);
    expect(format.yScale).toBe("log");
    expect(format.showGrid).toBe(false);
    expect(JSON.stringify(format)).not.toMatch(/xKey|yKeys|xLim|plotTitle/);
  });

  it("patches another graph's series in order and leaves data, limits and titles alone", () => {
    const format = captureGraphFormat(source, [4, 6]);
    const patch = graphFormatPatch(format, [0, 1, 2], { 2: { color: "#999999" }, 0: { width: 9 } });
    expect(patch.seriesStyles).toEqual({ 0: { color: "#112233", width: 3 }, 1: { marker: true, markerShape: "diamond" }, 2: { color: "#999999" } });
    expect(patch.yScale).toBe("log");
    expect(patch.xFmt).toEqual({ mode: "sci", digits: 3 });
    for (const key of ["xKey", "yKeys", "xLim", "yLim", "plotTitle", "xAxisLabel", "annotations"]) {
      expect(patch).not.toHaveProperty(key);
    }
  });

  it("a position with an automatic style clears the target's override there", () => {
    const format = captureGraphFormat({ ...source, seriesStyles: {} }, [4]);
    expect(graphFormatPatch(format, [0], { 0: { color: "#123456" } }).seriesStyles).toEqual({});
  });

  it("round-trips through the untrusted-storage sanitizer and rejects junk", () => {
    const format = captureGraphFormat(source, [4, 6]);
    expect(sanitizeGraphFormat(JSON.parse(JSON.stringify(format)))).toEqual(format);
    expect(sanitizeGraphFormat({ version: 99, series: [] })).toBeNull();
    expect(sanitizeGraphFormat("nope")).toBeNull();
    expect(sanitizeGraphFormat({ version: 1, series: [{ colorBy: 3, color: "#000000" }], yScale: "bogus" })?.series).toEqual([{ color: "#000000" }]);
  });

  it("maps a publication (export-wire) style to the interactive one", () => {
    expect(seriesStyleFromExport({ color: "#ff0000", width: 2, line: "dashed", marker: true, marker_size: 6, marker_shape: "square" }))
      .toEqual({ color: "#ff0000", width: 2, line: "dashed", marker: true, markerSize: 6, markerShape: "square" });
    expect(seriesStyleFromExport({ line: "none", marker: true })).toEqual({ width: 0, marker: true });
    // A palette-derived colour is not a choice the template made.
    expect(seriesStyleFromExport({ color: "#a785fc", colorDerived: true })).toBeNull();
    expect(seriesStyleFromExport(null)).toBeNull();
  });
});
