// Gap audit 5 #1: a default graph template for NEW graphs (Origin's "set as
// default"). Each case was run against the tree without the feature first.
import { beforeEach, describe, expect, it } from "vitest";

import { CHROME_KEYS, defaultGraphFormat, installDefaultGraphTemplate, setDefaultGraphTemplate } from "./defaultGraphTemplate";
import { saveGraphTemplate } from "./figuredoc";
import { buildFigureSpec } from "./figureSpec";
import { captureGraphFormat, graphFormatPatch, type GraphFormat } from "./graphFormat";
import { plotInNewWindow } from "./plotInNewWindow";
import { defaultPlotView, type PlotView } from "./plotview";
import { quickPlotFigureSeed } from "./quickPlot";
import type { Dataset } from "./types";
import { warmDefaultGraphTemplate } from "../commands/plotCommands";
import { DEFAULT_GRAPH_TEMPLATE_KEY } from "../store/prefs";
import { useApp } from "../store/useApp";
import { datasetViewDefaults, newGraphView, setNewGraphStyler } from "../store/windowDefaults";
import { plotWindowView } from "../store/windowDocuments";
import { viewHasUserEdits } from "../store/windowUserEdits";

const csv = (id: string, metadata: Record<string, unknown> = {}): Dataset => ({
  id,
  name: `${id}.csv`,
  data: { time: [1, 2, 3], values: [[1, 5], [2, 6], [3, 7]], labels: ["A", "B"], units: ["", ""], metadata: { technique: "generic", ...metadata } },
});

/** The lab look: ticks in, no grid, no frame, APS font/width, bold axis
 *  titles, a log Y and a limit (neither may travel), two series styles. */
function labFormat(): GraphFormat {
  const view: PlotView = {
    ...defaultPlotView(),
    xFmt: { mode: "auto", digits: 2, ticks: "in" },
    yFmt: { mode: "auto", digits: 3, ticks: "in" },
    showGrid: false,
    showAxisBox: false,
    legendPos: "nw",
    plotTemplate: "aps",
    axisLabelStyles: { x: { bold: true, size: 14 } },
    yScale: "log",
    xReversed: true,
    seriesStyles: { 0: { color: "#123456", width: 3 }, 1: { marker: true, markerShape: "diamond", markerSize: 7 } },
  };
  return captureGraphFormat(view, [0, 1]);
}

function setLabDefault(name = "Lab"): void {
  saveGraphTemplate({ name, style: "default", overrides: null, seriesStyles: null, format: labFormat() });
  setDefaultGraphTemplate(name);
}

const s = useApp.getState;
const plain = (ds?: Dataset): PlotView => ({ ...defaultPlotView(), ...datasetViewDefaults(ds) });

beforeEach(() => {
  localStorage.clear();
  setNewGraphStyler(null);
  useApp.setState(useApp.getInitialState(), true);
});

describe("default graph template: new graphs", () => {
  it("without a default, a new graph is exactly the built-in fresh view", () => {
    installDefaultGraphTemplate();
    expect(newGraphView(csv("a"))).toEqual(plain(csv("a")));
  });

  it("a new graph opens with the template's chrome and per-position series styles", () => {
    setLabDefault();
    const view = newGraphView(csv("a"));
    expect(view.xFmt).toEqual({ mode: "auto", digits: 2, ticks: "in" });
    expect(view.yFmt).toEqual({ mode: "auto", digits: 3, ticks: "in" });
    expect([view.showGrid, view.showAxisBox, view.legendPos, view.plotTemplate]).toEqual([false, false, "nw", "aps"]);
    expect(view.axisLabelStyles).toEqual({ x: { bold: true, size: 14 } });
    expect(view.seriesStyles).toEqual({ 0: { color: "#123456", width: 3 }, 1: { marker: true, markerShape: "diamond", markerSize: 7 } });
  });

  it("never overrides dataset-aware defaults: technique scales, X reversal, parser style hints", () => {
    setLabDefault();
    const xrd = newGraphView(csv("x", { technique: "xrd.powder" }));
    expect(xrd.yScale).toBe("log"); // the technique's, not the template's
    expect(newGraphView(csv("g")).yScale).toBe("linear"); // generic: linear, the template's log never travels
    expect(newGraphView(csv("g")).xReversed).toBe(false);
    expect(newGraphView(csv("ir", { x_reversed: true })).xReversed).toBe(true);
    // A peak list's scatter hint wins over the template's line style, per channel.
    const peaks = newGraphView(csv("p", { default_trace: "Scatter" }));
    expect(peaks.seriesStyles[0]).toEqual({ marker: true, width: 0 });
  });

  it("is the same view Apply Graph Template gives, and the export carries it (screen = export)", () => {
    setLabDefault();
    const ds = csv("a");
    const templated = newGraphView(ds);
    setNewGraphStyler(null);
    const base = plain(ds);
    const applied = { ...base, ...graphFormatPatch(labFormat(), [0, 1], {}, base), xScale: base.xScale, yScale: base.yScale, xReversed: base.xReversed };
    for (const k of [...CHROME_KEYS, "seriesStyles"] as const) expect(templated[k]).toEqual(applied[k]);
    const opts = { fmt: "pdf", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };
    const spec = buildFigureSpec((() => ({})) as never, ds, "a", opts, {}, templated);
    expect(spec).toEqual(buildFigureSpec((() => ({})) as never, ds, "a", opts, {}, applied));
    expect(spec.series_styles?.[0]).toMatchObject({ color: "#123456", width: 3 });
    expect(spec.series_styles?.[1]).toMatchObject({ marker: true, marker_shape: "diamond", marker_size: 7 });
  });

  it("fails closed: a default naming no saved template applies nothing and says so", () => {
    localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, JSON.stringify("Gone"));
    installDefaultGraphTemplate();
    expect(defaultGraphFormat()).toBeNull();
    expect(newGraphView(csv("a"))).toEqual(plain(csv("a")));
    expect(s().status).toMatch(/"Gone" not found/);
    localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, "{damaged");
    expect(newGraphView(csv("a"))).toEqual(plain(csv("a")));
  });

  it("re-saving the template under its name changes the default; clearing it restores the built-in look", () => {
    setLabDefault();
    saveGraphTemplate({ name: "Lab", style: "default", overrides: null, seriesStyles: null, format: { ...labFormat(), plotTemplate: "poster" } });
    expect(newGraphView(csv("a")).plotTemplate).toBe("poster");
    setDefaultGraphTemplate(null);
    expect(localStorage.getItem(DEFAULT_GRAPH_TEMPLATE_KEY)).toBeNull();
    expect(newGraphView(csv("a"))).toEqual(plain(csv("a")));
  });

  it("the boot loads the chunk only when a default is set", async () => {
    expect(warmDefaultGraphTemplate()).toBeNull();
    saveGraphTemplate({ name: "Lab", style: "default", overrides: null, seriesStyles: null, format: labFormat() });
    localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, JSON.stringify("Lab"));
    await warmDefaultGraphTemplate();
    expect(newGraphView(csv("a")).plotTemplate).toBe("aps");
  });
});

describe("default graph template: the store's graphs", () => {
  it("the empty startup window takes it, and the first import keeps it without reading as edited", () => {
    setLabDefault();
    expect([s().plotTemplate, s().showAxisBox]).toEqual(["aps", false]);
    s().addDataset(csv("a"));
    s().addDataset(csv("b")); // an unedited window: rebound, not a second window
    expect(s().plotWindows).toHaveLength(1);
    expect(s().activeId).toBe("b");
    expect([s().plotTemplate, s().xFmt.ticks]).toEqual(["aps", "in"]);
    expect(s().seriesStyles[0]).toEqual({ color: "#123456", width: 3 });
    expect(viewHasUserEdits({ ...defaultPlotView(), ...s() } as PlotView, csv("b"))).toBe(false);
  });

  it("an import that opens a new window (the focused graph is edited) and Quick Plot open templated graphs", () => {
    s().addDataset(csv("a"));
    s().setPlotTitle("styled by hand");
    setLabDefault();
    s().addDataset(csv("b"));
    expect(s().plotWindows).toHaveLength(2);
    expect([s().activeId, s().plotTemplate, s().seriesStyles[1]?.markerShape]).toEqual(["b", "aps", "diamond"]);
    expect(quickPlotFigureSeed(csv("c", { technique: "magnetometry.mvsh" })).view.plotTemplate).toBe("aps");
  });

  it("Plot in New Window opens a templated graph", () => {
    s().addDataset(csv("a"));
    setLabDefault();
    const id = plotInNewWindow("a");
    expect(s().focusedWindowId).toBe(id);
    expect([s().plotTemplate, s().showGrid, s().seriesStyles[0]?.color]).toEqual(["aps", false, "#123456"]);
  });

  it("leaves existing graphs alone, and a createWindow with no seed (Origin, saved figures) gets no chrome", () => {
    s().addDataset(csv("a"));
    const before = plotWindowView(s().plotWindows[0]);
    setLabDefault();
    expect(s().plotTemplate).toBe("screen"); // the bound, focused graph is not restyled
    expect(plotWindowView(s().plotWindows[0]).plotTemplate).toBe(before.plotTemplate);
    const id = s().createWindow("a", undefined, "Graph1");
    const win = s().plotWindows.find((w) => w.id === id)!;
    expect([win.view.plotTemplate, win.view.showAxisBox]).toEqual(["screen", true]);
  });

  it("an edited empty window is not restyled", () => {
    s().setPlotTitle("my sketch");
    setLabDefault();
    expect(s().plotTemplate).toBe("screen");
  });
});
