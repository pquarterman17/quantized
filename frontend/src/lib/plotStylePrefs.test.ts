// PREFS_AUDIT lane 2: plot-style defaults. Each pref reaches the canvas AND
// the export request; the default reproduces today's output exactly.

import { afterEach, describe, expect, it } from "vitest";

import { withDefaultTrace } from "./exportDefaultTrace";
import type { FigureSpec } from "./api/figures";
import { viewOverrides } from "./figureViewOverrides";
import { DEFAULT_MARKER_PX, markerDecision } from "./markers";
import { PLOT_TEMPLATES, resolveTemplate } from "./plotTemplates";
import {
  PLOT_STYLE_DEFAULTS,
  gridDefault,
  plotStyleSeed,
  plotStylePrefsSlot,
  screenFontPt,
} from "./plotStylePrefs";
import { defaultPlotView } from "./plotview";
import { toWireSeriesStyles } from "./exportStyles";
import { writePrefSlot } from "./prefSlots";
import { reseedPlotViewDefaults } from "./plotStylePrefsReseed";
import { useApp } from "../store/useApp";

afterEach(() => {
  plotStylePrefsSlot.reset();
  localStorage.removeItem("qz.prefs");
});

const save = (patch: Partial<typeof PLOT_STYLE_DEFAULTS>) => plotStylePrefsSlot.save({ ...PLOT_STYLE_DEFAULTS, ...patch });

describe("defaults reproduce today's output (provisional, owner to confirm)", () => {
  it("the defaults are the hardcoded values", () => {
    expect(PLOT_STYLE_DEFAULTS).toEqual({ markerSize: 5, fontSize: 12, tickDirection: "auto", legendPos: "auto" });
    expect(DEFAULT_MARKER_PX).toBe(5);
    expect(PLOT_TEMPLATES[0].fontSize).toBe(12);
  });

  it("defaultPlotView keeps its pre-pref literals", () => {
    const v = defaultPlotView();
    expect(v.showGrid).toBe(true);
    expect(v.legendPos).toBe("auto");
    expect(v.xFmt).toEqual({ mode: "auto", digits: 2 });
    expect(v.yFmt).toEqual({ mode: "auto", digits: 2 });
  });

  it("the canvas and export look is unchanged: 5 px markers, no font override, same template object", () => {
    expect(markerDecision(undefined, "Scatter").size).toBe(5);
    expect(toWireSeriesStyles([{ marker: true }], false)[0]).toEqual({ marker: true, marker_size: 5 });
    expect(resolveTemplate("screen")).toBe(PLOT_TEMPLATES[0]);
    expect(screenFontPt("screen")).toBeUndefined();
    const base = defaultPlotView();
    expect(viewOverrides(base, [])).not.toHaveProperty("font_size");
  });
});

describe("Marker size reaches the canvas and the export wire", () => {
  it("ambient default-trace marker, explicit sizeless marker, and the exported marker_size", () => {
    save({ markerSize: 9 });
    expect(markerDecision(undefined, "Scatter").size).toBe(9);
    expect(markerDecision({ marker: true }, "Line").size).toBe(9);
    expect(markerDecision({ marker: true, markerSize: 3 }, "Line").size).toBe(3); // explicit still wins
    expect(toWireSeriesStyles([{ marker: true }], false)[0]).toEqual({ marker: true, marker_size: 9 });
    const spec = withDefaultTrace({ y_keys: [0] } as FigureSpec, "Scatter", {});
    expect(spec.series_styles?.[0]?.marker_size).toBe(9);
  });

  it("clamps an out-of-range stored value", () => {
    writePrefSlot("qz.plotStylePrefs", { markerSize: 99, fontSize: 1, tickDirection: "sideways", legendPos: "x" });
    expect(plotStylePrefsSlot.load()).toEqual({ markerSize: 16, fontSize: 8, tickDirection: "auto", legendPos: "auto" });
  });
});

describe("Font size", () => {
  it("re-sizes the Screen template only, and rides the export as font_size", () => {
    save({ fontSize: 15 });
    expect(resolveTemplate("screen").fontSize).toBe(15);
    expect(resolveTemplate("aps").fontSize).toBe(9);
    expect(PLOT_TEMPLATES[0].fontSize).toBe(12); // the table itself is never mutated
    expect(screenFontPt("screen")).toBeCloseTo(12.5); // 15 px x 10/12 (the 12 px / 10 pt default pairing)
    expect(screenFontPt("aps")).toBeUndefined();
    const v = { ...defaultPlotView(), plotTemplate: "screen" };
    expect(viewOverrides(v, [])?.font_size).toBeCloseTo(12.5);
    expect(viewOverrides({ ...v, plotTemplate: "aps" }, [])).not.toHaveProperty("font_size");
  });
});

describe("Tick direction and legend position seed new plots (canvas and export read the view)", () => {
  it("tick direction rides xFmt/yFmt.ticks, which axisExtras and x_fmt.ticks both read", () => {
    save({ tickDirection: "in" });
    expect(defaultPlotView().xFmt).toEqual({ mode: "auto", digits: 2, ticks: "in" });
    expect(defaultPlotView().yFmt).toEqual({ mode: "auto", digits: 2, ticks: "in" });
    save({ tickDirection: "auto" });
    expect(defaultPlotView().xFmt).toEqual({ mode: "auto", digits: 2 });
  });

  it("legend position seeds legendPos, which exports as legend.loc", () => {
    save({ legendPos: "sw" });
    const v = defaultPlotView();
    expect(v.legendPos).toBe("sw");
    expect(viewOverrides(v, [])?.legend).toMatchObject({ show: true, loc: "lower left" });
  });
});

describe("P1-5: Grid lines pref seeds new plots", () => {
  it("defaultPlotView reads the pref instead of hardcoding true", () => {
    expect(gridDefault()).toBe(true);
    writePrefSlot("qz.prefs", { defaultGrid: false });
    expect(gridDefault()).toBe(false);
    expect(defaultPlotView().showGrid).toBe(false);
    writePrefSlot("qz.prefs", { defaultGrid: "no" }); // wrong type: fail closed to today's true
    expect(defaultPlotView().showGrid).toBe(true);
  });

  it("re-seeds the live view after hydration, only on a blank workspace", () => {
    const before = useApp.getState();
    useApp.setState({ datasets: [], plotWindows: [] });
    writePrefSlot("qz.prefs", { defaultGrid: false });
    save({ legendPos: "nw", tickDirection: "both" });
    expect(reseedPlotViewDefaults()).toBe(true);
    expect(useApp.getState().showGrid).toBe(false);
    expect(useApp.getState().legendPos).toBe("nw");
    expect(useApp.getState().xFmt.ticks).toBe("both");
    // once a dataset exists the view is the user's
    useApp.setState({ datasets: [{ id: "d", name: "d", data: { time: [], values: [], labels: [], units: [], metadata: {} } }], showGrid: true });
    expect(reseedPlotViewDefaults()).toBe(false);
    expect(useApp.getState().showGrid).toBe(true);
    useApp.setState({ datasets: before.datasets, plotWindows: before.plotWindows, showGrid: before.showGrid, legendPos: before.legendPos, xFmt: before.xFmt, yFmt: before.yFmt });
    expect(plotStyleSeed().legendPos).toBe("nw");
  });
});

describe("tick direction reaches the export request end to end", () => {
  it("a document made from a new plot under 'in' sends x_fmt.ticks and y_fmt.ticks", async () => {
    const { createFigureDocument } = await import("./figureDocument");
    const { buildFigureSpecFromDocument } = await import("./figureSpec");
    const ds = { id: "d1", name: "s.csv", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: ["u"], metadata: {} } };
    const build = () => buildFigureSpecFromDocument(createFigureDocument({ id: "f1", name: "f", datasetId: "d1", view: { ...defaultPlotView(), yKeys: [0] } }), ds, "s");
    expect(build().x_fmt?.ticks).toBeUndefined();
    save({ tickDirection: "in", legendPos: "ne" });
    const spec = build();
    expect(spec.x_fmt?.ticks).toBe("in");
    expect(spec.y_fmt?.ticks).toBe("in");
    expect(spec.overrides?.legend?.loc).toBe("upper right");
  });
});
