import { afterEach, describe, expect, it, vi } from "vitest";

import { buildExportStyles } from "./exportStyles";
import type { PlotPayload } from "./plotdata";
import { DASH, setAutoSeriesStyles } from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";
import { buildOpts } from "./uplotOpts";

describe("buildExportStyles", () => {
  it("carries width / line / marker overrides per channel in plotted order", () => {
    const styles: Record<number, SeriesStyle> = {
      2: { width: 3, line: "dashed", marker: true, markerSize: 6 },
    };
    // plotted channels [2, 0]: index 0 → channel 2 (styled), index 1 → channel 0
    const out = buildExportStyles([2, 0], styles);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ width: 3, line: "dashed", marker: true, marker_size: 6 });
    // channel 0 has no override → only the resolved palette color (or null in jsdom)
    expect(out[1]?.width).toBeUndefined();
  });

  it("omits a marker_size when markers are off", () => {
    const out = buildExportStyles([0], { 0: { marker: false } });
    expect(out[0]?.marker).toBeUndefined();
    expect(out[0]?.marker_size).toBeUndefined();
  });

  // ── MAIN #13: fill under/between ────────────────────────────────────────
  it("carries fill: 'under' through unchanged", () => {
    const out = buildExportStyles([0], { 0: { fill: "under" } });
    expect(out[0]?.fill).toBe("under");
  });

  it("carries fill: {vs: channel} as a dataset channel index (not a display position)", () => {
    const out = buildExportStyles([2, 0], { 2: { fill: { vs: 0 } } });
    expect(out[0]?.fill).toEqual({ vs: 0 });
  });

  it("omits fill when it's 'none' (the default, no wire noise)", () => {
    const out = buildExportStyles([0], { 0: { fill: "none" } });
    expect(out[0]?.fill).toBeUndefined();
  });

  // ── MAIN #14: colour-mapped scatter ─────────────────────────────────────
  it("carries color_by + colormap (defaulting to viridis)", () => {
    const out = buildExportStyles([0], { 0: { colorBy: 2 } });
    expect(out[0]).toMatchObject({ color_by: 2, colormap: "viridis" });
  });

  it("respects an explicit colormap override", () => {
    const out = buildExportStyles([0], { 0: { colorBy: 2, colormap: "magma" } });
    expect(out[0]?.colormap).toBe("magma");
  });

  it("omits color_by/colormap when colorBy is unset", () => {
    const out = buildExportStyles([0], { 0: { width: 2 } });
    expect(out[0]?.color_by).toBeUndefined();
    expect(out[0]?.colormap).toBeUndefined();
  });

  // ── GAP_PLOTTYPES: Graph Builder "step" mark export parity ──────────────
  it("carries step through — the chokepoint every export path (ordinary Export figure…, Figure Builder, Figure Page) shares", () => {
    const out = buildExportStyles([0], { 0: { step: "mid" } });
    expect(out[0]?.step).toBe("mid");
  });

  it("omits step when unset (no wire noise)", () => {
    const out = buildExportStyles([0], { 0: { width: 2 } });
    expect(out[0]?.step).toBeUndefined();
  });
});

// ── P3.3 auto dash/marker cycle: THE EXPORT-PARITY GUARD ────────────────────
// This is the test that FEATURE-001 (plans/BUGS_AND_ISSUES.md) exists to
// demand. A faceted per-series-styling fix was built, reviewed and REVERTED
// there precisely because it would have made the export honour something the
// screen did not. So this block does not check that each side "has some dash";
// it drives BOTH real builders over the SAME plot and asserts the two resolved
// sets are EQUAL, series for series, in both directions:
//
//   canvas   : buildOpts(...).series[i + 1].dash   / .points.paths
//   export   : buildExportStyles(...)[i].line      / .marker_shape
//
// They can only agree because one function (`resolveSeriesStyle`) decides, and
// the backend is handed an ordinary explicit style — `calc.figure._LINESTYLE` /
// `_MARKER` never learn that a cycle exists.
describe("auto dash/marker cycle — canvas/export parity (FEATURE-001 guard)", () => {
  const payload: PlotPayload = {
    data: [
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
      [3, 4, 5],
    ],
    series: [{ label: "A", unit: "" }, { label: "B", unit: "" }, { label: "C", unit: "" }],
    xLabel: "x",
    xUnit: "",
  };
  const plotted = [0, 1, 2];
  const optsArgs = {
    width: 600,
    height: 400,
    xScale: "linear" as const,
    yScale: "linear" as const,
    tool: "zoom" as const,
    onReadout: vi.fn(),
  };

  /** The dash the CANVAS will draw for each series, in display order. */
  const canvasDashes = (styles: Record<number, SeriesStyle>) =>
    (buildOpts(payload, { ...optsArgs, seriesStyles: plotted.map((ch) => styles[ch]) }).series ?? [])
      .slice(1)
      .map((s) => (s as { dash?: number[] }).dash);

  /** The dash the EXPORT will draw for each series, translated through the same
   *  DASH table the canvas uses, so the two are comparable values. The wire
   *  type's extra `"none"` (point-only scatter) has no canvas dash by
   *  definition, so it maps to undefined like `"solid"` does. */
  const exportDashes = (styles: Record<number, SeriesStyle>) =>
    buildExportStyles(plotted, styles).map((spec) =>
      spec?.line && spec.line !== "none" ? DASH[spec.line] : undefined,
    );

  afterEach(() => setAutoSeriesStyles(false));

  it("OFF: neither side encodes a dash (and they agree about that)", () => {
    expect(canvasDashes({})).toEqual([undefined, undefined, undefined]);
    expect(exportDashes({})).toEqual([undefined, undefined, undefined]);
    expect(buildExportStyles(plotted, {}).map((s) => s?.line)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("ON: the export spec carries the SAME dash per series the canvas draws", () => {
    setAutoSeriesStyles(true);
    const canvas = canvasDashes({});
    const exported = exportDashes({});
    expect(exported).toEqual(canvas); // the parity assertion itself
    // …and it is a meaningful agreement, not two empty lists agreeing:
    expect(new Set(canvas.map((d) => JSON.stringify(d))).size).toBe(3);
  });

  it("ON: parity holds when some series are explicitly styled and some are not", () => {
    setAutoSeriesStyles(true);
    const styles: Record<number, SeriesStyle> = { 1: { line: "dotted" }, 2: { width: 3 } };
    expect(exportDashes(styles)).toEqual(canvasDashes(styles));
    // series 2 keeps its explicit dotted despite the cycle wanting "dashed"
    expect(buildExportStyles(plotted, styles)[1]?.line).toBe("dotted");
  });

  it("ON: the exported marker_shape is the SAME glyph the canvas paths builder uses", () => {
    setAutoSeriesStyles(true);
    const styles: Record<number, SeriesStyle> = {
      0: { marker: true },
      1: { marker: true },
      2: { marker: true, markerShape: "star" },
    };
    const shapes = buildExportStyles(plotted, styles).map((s) => s?.marker_shape);
    expect(shapes).toEqual(["circle", "square", "star"]); // cycle, cycle, explicit
    // The canvas side agrees: a circle is uPlot's own renderer (no paths
    // builder), every other glyph supplies one — so "has a builder" is exactly
    // "is not a circle", which is what the shape list above claims.
    const pts = (buildOpts(payload, { ...optsArgs, seriesStyles: plotted.map((ch) => styles[ch]) })
      .series ?? [])
      .slice(1)
      .map((s) => s.points);
    expect(pts.map((p) => typeof p?.paths === "function")).toEqual(
      shapes.map((sh) => sh !== "circle"),
    );
  });

  it("ON: no marker_shape leaks onto a series that draws no marker", () => {
    // The glyph is resolved for every series but stays behind the `marker` gate
    // on BOTH sides, so a line-only plot exports exactly as before.
    setAutoSeriesStyles(true);
    const out = buildExportStyles(plotted, {});
    expect(out.map((s) => s?.marker)).toEqual([undefined, undefined, undefined]);
    expect(out.map((s) => s?.marker_shape)).toEqual([undefined, undefined, undefined]);
  });
});
