import { describe, expect, it, vi } from "vitest";

import { plotSpecFigureReason, plotSpecToFigureDoc } from "./plotSpecFigure";
import type { PlotSpec } from "./plotspec";

vi.spyOn(Date, "now").mockReturnValue(1234);

const xy = (over: Partial<PlotSpec> = {}): PlotSpec => ({
  version: 1,
  zones: {
    x: { datasetId: "d1", channel: 0 },
    y: [{ datasetId: "d1", channel: 2 }, { datasetId: "d1", channel: 1 }],
    group: null,
    facet: null,
    yErr: [],
    xErr: null,
  },
  mark: "line",
  ...over,
});

describe("plotSpecToFigureDoc", () => {
  it("preserves explicit X/Y display order in an ephemeral live FigureDoc", () => {
    const doc = plotSpecToFigureDoc(xy(), "My graph", { 2: { width: 3 } });
    expect(doc).toMatchObject({
      id: "plotspec-ya",
      name: "My graph",
      datasetId: "d1",
      live: true,
      config: { xKey: 0, yKeys: [2, 1], fmt: "pdf", style: "default" },
    });
    expect(doc?.config.seriesStyles?.[0]).toMatchObject({ width: 3 });
  });

  // Regression pin (GUI_INTERACTION #12 Slice 3): a v1 spec (no display/axes
  // blocks) must fall back to EXACTLY today's behavior — the live
  // `seriesStyles` arg drives styling, and axes/title/overrides stay at
  // their pre-Slice-3 hardcoded defaults, never silently picking up
  // something from the (absent) blocks.
  it("a v1 spec's axes/title/overrides stay at their pre-Slice-3 defaults (regression pin)", () => {
    const doc = plotSpecToFigureDoc(xy(), "My graph", { 2: { width: 3 } });
    expect(doc?.config).toMatchObject({
      xScale: "linear",
      yScale: "linear",
      title: "",
      xLabel: "",
      yLabel: "",
      overrides: null,
    });
  });

  it("maps scatter to an honest point-only publication style", () => {
    const doc = plotSpecToFigureDoc(xy({ mark: "scatter" }), "", {});
    expect(doc?.config.seriesStyles).toEqual([
      { color: expect.any(String), line: "none", marker: true },
      { color: expect.any(String), line: "none", marker: true },
    ]);
  });

  // ── GAP_PLOTTYPES: "step" mark + showMarkers publication parity ─────────
  it("maps step (default 'post') to a step-drawstyle publication style, no forced markers", () => {
    const doc = plotSpecToFigureDoc(xy({ mark: "step" }), "", {});
    expect(doc?.config.seriesStyles).toEqual([
      { color: expect.any(String), step: "post" },
      { color: expect.any(String), step: "post" },
    ]);
  });

  it("maps step + showMarkers to Origin's Line + Symbol equivalent", () => {
    const doc = plotSpecToFigureDoc(xy({ mark: "step", stepMode: "mid", showMarkers: true }), "", {});
    expect(doc?.config.seriesStyles).toEqual([
      { color: expect.any(String), step: "mid", marker: true },
      { color: expect.any(String), step: "mid", marker: true },
    ]);
  });

  it("line stays plain without showMarkers, but adds markers when showMarkers is set", () => {
    const plain = plotSpecToFigureDoc(xy({ mark: "line" }), "", {});
    expect(plain?.config.seriesStyles?.[0]?.marker).toBeUndefined();
    const withMarkers = plotSpecToFigureDoc(xy({ mark: "line", showMarkers: true }), "", {});
    expect(withMarkers?.config.seriesStyles?.[0]?.marker).toBe(true);
    expect(withMarkers?.config.seriesStyles?.[0]?.line).toBeUndefined(); // still a real line, not "none"
  });

  // Regression pin (GUI_INTERACTION #12 Slice 5): faceted/statistical/
  // incomplete/cross-dataset specs stay fail-closed exactly as before --
  // ONLY grouped (without y2) was un-fail-closed this slice.
  it("fails closed for faceted, statistical, incomplete, or cross-dataset specs", () => {
    const faceted = xy({ zones: { ...xy().zones, facet: { datasetId: "d1", channel: 3 } } });
    const statistical = xy({ mark: "box" });
    const incomplete = xy({ zones: { ...xy().zones, y: [] } });
    const mixed = xy({ zones: { ...xy().zones, y: [{ datasetId: "d2", channel: 1 }] } });
    for (const spec of [faceted, statistical, incomplete, mixed]) {
      expect(plotSpecToFigureDoc(spec, "bad", {})).toBeNull();
      expect(plotSpecFigureReason(spec)).not.toBeNull();
    }
  });

  // #12 Slice 5 (finishing the Slice 3 investigation's named residual): a
  // group split now opens in Figure Builder -- FigureConfig.groupCol /
  // FigureSpec.group_col carry the split through to
  // calc.plotting.build_grouped_series, the backend's faithful port of
  // buildXY. Per-channel styling is dropped (not misapplied) since it
  // doesn't align 1:1 with the synthetic per-level series.
  it("opens a grouped spec (no y2) in Figure Builder, carrying groupCol and dropping seriesStyles", () => {
    const grouped = xy({ zones: { ...xy().zones, group: { datasetId: "d1", channel: 3 } } });
    expect(plotSpecFigureReason(grouped)).toBeNull();
    const doc = plotSpecToFigureDoc(grouped, "Grouped plot", { 2: { color: "#ffffff" } });
    expect(doc).not.toBeNull();
    expect(doc?.config.groupCol).toBe(3);
    expect(doc?.config.yKeys).toEqual([2, 1]);
    expect(doc?.config.seriesStyles).toBeNull();
  });

  // A grouped spec that ALSO uses the secondary axis stays fail-closed --
  // buildXY never assigns a grouped series to axis 1, so there's no sound
  // semantic for the combination (mirrors the backend's 422 for
  // group_col + y2_keys, routes/export_figures.py's _figure_series).
  it("keeps a grouped spec fail-closed when it also uses the secondary (Y2) axis", () => {
    const groupedY2 = xy({
      version: 2,
      zones: { ...xy().zones, group: { datasetId: "d1", channel: 3 } },
      display: { series: { 1: { axis: 1 } } },
    });
    const reason = plotSpecFigureReason(groupedY2);
    expect(reason).not.toBeNull();
    expect(reason).toContain("secondary");
    expect(plotSpecToFigureDoc(groupedY2, "bad", {})).toBeNull();
  });

  it("a non-grouped spec's config.groupCol is null", () => {
    const doc = plotSpecToFigureDoc(xy(), "My graph", {});
    expect(doc?.config.groupCol).toBeNull();
  });
});

// ── Error wells handoff (ORIGIN_GAP_PLAN #51 phase 3) ───────────────────────
// So Publication Preview opened directly from Graph Builder (without a prior
// commit to a plot) still carries the wells' error bars — see
// figureDocumentPublication.ts's threading into createFigureDocument.
describe("plotSpecToFigureDoc — error wells", () => {
  it("threads yErr/xErr into config.errors, position-paired with y (not channel order)", () => {
    // xy()'s y is [channel 2, channel 1] (display order); yErr[0] pairs to
    // y[0] (channel 2), yErr[1] to y[1] (channel 1) — NOT a channel-index sort.
    const spec = xy({
      zones: { ...xy().zones, yErr: [{ datasetId: "d1", channel: 5 }, { datasetId: "d1", channel: 6 }] },
    });
    const doc = plotSpecToFigureDoc(spec, "Errored", {});
    expect(doc?.config.errors).toEqual([
      { channel: 5, target: 2, axis: "y", side: "both" },
      { channel: 6, target: 1, axis: "y", side: "both" },
    ]);
  });

  it("threads xErr with the x-axis sentinel target -1", () => {
    const spec = xy({ zones: { ...xy().zones, xErr: { datasetId: "d1", channel: 7 } } });
    const doc = plotSpecToFigureDoc(spec, "Errored", {});
    expect(doc?.config.errors).toContainEqual({ channel: 7, target: -1, axis: "x", side: "both" });
  });

  it("is an empty array (not undefined) when no wells are set", () => {
    const doc = plotSpecToFigureDoc(xy(), "Plain", {});
    expect(doc?.config.errors).toEqual([]);
  });

  it("omits errors for a grouped spec (same gate as seriesStyles -- no sound 1:1 mapping)", () => {
    const grouped = xy({
      zones: {
        ...xy().zones,
        group: { datasetId: "d1", channel: 3 },
        yErr: [{ datasetId: "d1", channel: 5 }, { datasetId: "d1", channel: 6 }],
      },
    });
    const doc = plotSpecToFigureDoc(grouped, "Grouped", {});
    expect(doc?.config.errors).toEqual([]);
    expect(doc?.config.seriesStyles).toBeNull(); // the existing sibling gate, for contrast
  });
});

// ── v2 blocks (GUI_INTERACTION_PLAN #12 Slice 3) ────────────────────────────
describe("plotSpecToFigureDoc — v2 blocks win over the live arg", () => {
  it("a v2 display block wins over the live seriesStyles arg entirely (per-channel color/width)", () => {
    const spec = xy({
      version: 2,
      display: {
        series: {
          2: { color: "#123456", width: 4 },
          1: { color: "#abcdef" },
        },
      },
    });
    // A DIFFERENT live arg proves it's ignored, not merely unused by luck.
    const doc = plotSpecToFigureDoc(spec, "Styled", { 2: { color: "#ffffff" }, 1: { width: 99 } });
    expect(doc?.config.seriesStyles).toEqual([
      { color: "#123456", width: 4 },
      { color: "#abcdef" },
    ]);
  });

  it("scatter still maps a v2-styled spec to a point-only publication style", () => {
    const spec = xy({
      version: 2,
      mark: "scatter",
      display: { series: { 2: { color: "#123456" }, 1: { color: "#abcdef" } } },
    });
    const doc = plotSpecToFigureDoc(spec, "Styled", {});
    expect(doc?.config.seriesStyles).toEqual([
      { color: "#123456", line: "none", marker: true },
      { color: "#abcdef", line: "none", marker: true },
    ]);
  });

  it("a v2 axes block maps title/label/scale/lim onto FigureConfig + overrides, per field", () => {
    const spec = xy({
      version: 2,
      axes: {
        title: "My Loop",
        x: { label: "Field (Oe)", scale: "log" },
        y: { label: "Moment (emu)", lim: [-10, 10] },
      },
    });
    const doc = plotSpecToFigureDoc(spec, "Axis-styled", {});
    expect(doc?.config.title).toBe("My Loop");
    expect(doc?.config.xLabel).toBe("Field (Oe)");
    expect(doc?.config.yLabel).toBe("Moment (emu)");
    expect(doc?.config.xScale).toBe("log");
    expect(doc?.config.yScale).toBe("linear"); // not set on this axis -> the v1 default
    expect(doc?.config.overrides).toEqual({ y_lim: [-10, 10] });
  });

  it("axes fields with no FigureOverrides equivalent (step/fmt) are simply omitted, never mapped", () => {
    const spec = xy({
      version: 2,
      axes: { x: { step: 5, fmt: { mode: "sci", digits: 2 } } },
    });
    const doc = plotSpecToFigureDoc(spec, "Stepped", {});
    expect(doc?.config.overrides).toBeNull(); // no lim on either axis -> nothing to carry
  });

  it("fails closed when a display series is assigned to the secondary (Y2) axis", () => {
    const spec = xy({ version: 2, display: { series: { 1: { axis: 1 } } } });
    expect(plotSpecToFigureDoc(spec, "bad", {})).toBeNull();
    expect(plotSpecFigureReason(spec)).toContain("secondary");
  });

  it("fails closed when the axes block carries an explicit y2 config, even with no flagged series", () => {
    const spec = xy({ version: 2, axes: { y2: { label: "Torque" } } });
    expect(plotSpecToFigureDoc(spec, "bad", {})).toBeNull();
    expect(plotSpecFigureReason(spec)).toContain("secondary");
  });
});
