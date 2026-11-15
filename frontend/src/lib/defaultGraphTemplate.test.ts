// Gap audit 5 #1: a default graph template for NEW graphs (Origin's "set as
// default"), tied to the windows it seeded (`templateSeeds`, review F1-F3).
// Each case was run against the tree without its fix first.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GRAPH_TEMPLATE_KEY, installDefaultGraphTemplate, resolveDefault, setDefaultGraphTemplate } from "./defaultGraphTemplate";
import { saveGraphTemplate } from "./figuredoc";
import { buildFigureSpec } from "./figureSpec";
import { captureGraphFormat, graphFormatPatch, type GraphFormat } from "./graphFormat";
import { plotInNewWindow } from "./plotInNewWindow";
import { defaultPlotView, type PlotView } from "./plotview";
import { quickPlotFigureSeed } from "./quickPlot";
import type { Dataset } from "./types";
import { warmDefaultGraphTemplate } from "../commands/plotCommands";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { datasetViewDefaults, newGraph, setNewGraphStyler, templateSeeds } from "../store/windowDefaults";
import { plotWindowView } from "../store/windowDocuments";
import { windowHasUserEdits } from "../store/windowUserEdits";

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
const newGraphView = (ds?: Dataset): PlotView => newGraph(ds);
const focusedWin = () => s().plotWindows.find((w) => w.id === s().focusedWindowId)!;
const toastTexts = () => useToasts.getState().toasts.map((t) => t.msg);

beforeEach(() => {
  localStorage.clear();
  setNewGraphStyler(null);
  templateSeeds.clear();
  useToasts.setState({ toasts: [] });
  useApp.setState(useApp.getInitialState(), true);
});

describe("default graph template: new graphs", () => {
  it("without a default, a new graph is exactly the built-in fresh view, unmarked", () => {
    installDefaultGraphTemplate();
    expect(newGraph(csv("a"))).toEqual(plain(csv("a")));
    expect(resolveDefault()).toBeNull();
  });

  it("a new graph opens with the template's chrome and per-position series styles", () => {
    setLabDefault();
    const view = newGraph(csv("a"));
    expect(resolveDefault()?.seed).toBeTruthy();
    expect(view.xFmt).toEqual({ mode: "auto", digits: 2, ticks: "in" });
    expect(view.yFmt).toEqual({ mode: "auto", digits: 3, ticks: "in" });
    expect([view.showGrid, view.showAxisBox, view.legendPos, view.plotTemplate]).toEqual([false, false, "nw", "aps"]);
    expect(view.axisLabelStyles).toEqual({ x: { bold: true, size: 14 } });
    expect(view.seriesStyles).toEqual({ 0: { color: "#123456", width: 3 }, 1: { marker: true, markerShape: "diamond", markerSize: 7 } });
  });

  it("never overrides dataset-aware defaults: technique scales, X reversal, parser style hints", () => {
    setLabDefault();
    expect(newGraphView(csv("x", { technique: "xrd.powder" })).yScale).toBe("log"); // the technique's
    expect(newGraphView(csv("g")).yScale).toBe("linear"); // the template's log never travels
    expect(newGraphView(csv("g")).xReversed).toBe(false);
    expect(newGraphView(csv("ir", { x_reversed: true })).xReversed).toBe(true);
    expect(newGraphView(csv("p", { default_trace: "Scatter" })).seriesStyles[0]).toEqual({ marker: true, width: 0 });
  });

  it("matches Apply Graph Template, and the export carries the template's styles", () => {
    setLabDefault();
    const ds = csv("a");
    const templated = newGraphView(ds);
    const base = plain(ds);
    const applied = { ...base, ...graphFormatPatch(labFormat(), [0, 1], {}, base), xScale: base.xScale, yScale: base.yScale, xReversed: base.xReversed };
    for (const k of ["xFmt", "yFmt", "showGrid", "showAxisBox", "legendPos", "plotTemplate", "axisLabelStyles", "seriesStyles"] as const) {
      expect(templated[k]).toEqual(applied[k]);
    }
    const opts = { fmt: "pdf", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };
    const spec = buildFigureSpec((() => ({})) as never, ds, "a", opts, {}, templated);
    // Hand-written: what the publication renderer is told, independent of the patch code.
    expect(spec.series_styles?.[0]).toMatchObject({ color: "#123456", width: 3 });
    expect(spec.series_styles?.[1]).toMatchObject({ marker: true, marker_shape: "diamond", marker_size: 7 });
    expect(spec.x_fmt).toEqual(buildFigureSpec((() => ({})) as never, ds, "a", opts, {}, { ...base, xFmt: { mode: "auto", digits: 2, ticks: "in" } }).x_fmt);
  });

  it("F5: a default naming no saved template applies nothing, with a toast a later status cannot hide", () => {
    localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, JSON.stringify("Gone"));
    installDefaultGraphTemplate();
    s().setStatus("backend ready"); // the boot's health check, after the chunk
    expect(newGraph(csv("a"))).toEqual(plain(csv("a")));
    expect(resolveDefault()?.seed).toBeNull();
    expect(toastTexts().some((m) => /"Gone" not found/.test(m))).toBe(true);
    localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, "{damaged");
    expect(resolveDefault()).toBeNull();
    expect(newGraph(csv("a"))).toEqual(plain(csv("a")));
  });

  it("F7: a format from a newer build applies its series only, and says so", () => {
    saveGraphTemplate({ name: "Next", style: "default", overrides: null, seriesStyles: [{ color: "#00aa00", width: 2 }], format: { ...labFormat(), version: 99 } });
    setDefaultGraphTemplate("Next");
    const view = newGraphView(csv("a"));
    expect(view.plotTemplate).toBe("screen");
    expect(view.seriesStyles[0]).toEqual({ color: "#00aa00", width: 2 });
    expect(toastTexts().some((m) => /cannot read/.test(m))).toBe(true);
  });

  it("F7: a template without a format (Origin .otp) does not force the grid on", () => {
    useApp.setState({ showGrid: false, defaultGrid: false });
    saveGraphTemplate({ name: "Otp", style: "default", overrides: null, seriesStyles: [{ color: "#00aa00", width: 2 }] });
    setDefaultGraphTemplate("Otp");
    expect(s().showGrid).toBe(false);
    expect(resolveDefault()?.seed?.chrome).not.toHaveProperty("showGrid");
  });

  it("F9: the template is read once per storage change, not on every use", () => {
    setLabDefault();
    const parse = vi.spyOn(JSON, "parse");
    newGraph(csv("a"));
    newGraph(csv("b"));
    expect(parse).not.toHaveBeenCalled();
    saveGraphTemplate({ name: "Lab", style: "default", overrides: null, seriesStyles: null, format: { ...labFormat(), plotTemplate: "poster" } });
    expect(newGraphView(csv("a")).plotTemplate).toBe("poster"); // re-saving changes the default
    parse.mockRestore();
  });

  it("clearing the default restores the built-in look", () => {
    setLabDefault();
    setDefaultGraphTemplate(null);
    expect(localStorage.getItem(DEFAULT_GRAPH_TEMPLATE_KEY)).toBeNull();
    expect(newGraphView(csv("a"))).toEqual(plain(csv("a")));
    expect(s().plotTemplate).toBe("screen"); // the empty startup window too
  });

  it("the boot loads the chunk only when a default is set", async () => {
    expect(warmDefaultGraphTemplate()).toBeUndefined();
    saveGraphTemplate({ name: "Lab", style: "default", overrides: null, seriesStyles: null, format: labFormat() });
    localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, JSON.stringify("Lab"));
    await warmDefaultGraphTemplate();
    expect(newGraphView(csv("a")).plotTemplate).toBe("aps");
  });
});

describe("default graph template: the store's graphs", () => {
  it("the empty startup window takes it; imports rebind it and keep the look, unedited", () => {
    setLabDefault();
    expect([s().plotTemplate, s().showAxisBox]).toEqual(["aps", false]);
    s().addDataset(csv("a"));
    s().addDataset(csv("b"));
    expect(s().plotWindows).toHaveLength(1);
    expect(s().activeId).toBe("b");
    expect([s().plotTemplate, s().xFmt.ticks]).toEqual(["aps", "in"]);
    expect(s().seriesStyles[0]).toEqual({ color: "#123456", width: 3 });
    expect(windowHasUserEdits(s(), focusedWin())).toBe(false);
  });

  it("F2: a plain graph made before the default is still unedited, and the next import replaces it", () => {
    s().addDataset(csv("a"));
    setLabDefault();
    expect(windowHasUserEdits(s(), focusedWin())).toBe(false);
    s().addDataset(csv("b"));
    expect(s().plotWindows).toHaveLength(1);
    expect(s().plotTemplate).toBe("screen"); // not a new graph: never templated
    expect(s().seriesStyles).toEqual({});
  });

  it("an import beside an edited graph, Plot in New Window and Quick Plot open templated graphs", () => {
    s().addDataset(csv("a"));
    s().setPlotTitle("styled by hand");
    setLabDefault();
    s().addDataset(csv("b"));
    expect(s().plotWindows).toHaveLength(2);
    expect([s().activeId, s().plotTemplate, s().seriesStyles[1]?.markerShape]).toEqual(["b", "aps", "diamond"]);
    const id = plotInNewWindow("a");
    expect(s().focusedWindowId).toBe(id);
    expect([s().plotTemplate, s().showGrid, s().seriesStyles[0]?.color]).toEqual(["aps", false, "#123456"]);
    expect(quickPlotFigureSeed(csv("c", { technique: "magnetometry.mvsh" })).view.plotTemplate).toBe("aps");
  });

  it("F3: an unmarked window never sees it -- no chrome, no series, built-in tick formats on a switch", () => {
    s().addDataset(csv("a"));
    s().addDataset(csv("b"));
    setLabDefault();
    // A seedless window (saved figure, Origin recovery, Graph Builder).
    const id = s().createWindow("a", undefined, "Graph1");
    const win = s().plotWindows.find((w) => w.id === id)!;
    expect([win.view.plotTemplate, win.view.showAxisBox, win.view.seriesStyles]).toEqual(["screen", true, {}]);
    // An in-place switch of a plain window (what an Origin apply does first).
    s().setActive("a");
    expect(s().xFmt).toEqual(defaultPlotView().xFmt);
    expect(s().seriesStyles).toEqual({});
  });

  it("leaves existing and edited empty graphs alone", () => {
    s().setPlotTitle("my sketch");
    setLabDefault();
    expect(s().plotTemplate).toBe("screen");
  });

  it("F4: an unrelated undo does not take the default off an empty graph", () => {
    s().addDataset(csv("a"));
    const empty = s().createWindow(null, undefined, "Empty");
    s().recordHistory("rename");
    useApp.setState({ datasets: s().datasets.map((d) => ({ ...d, name: "renamed.csv" })) });
    setLabDefault();
    const view = () => plotWindowView(s().plotWindows.find((w) => w.id === empty)!);
    expect(view().plotTemplate).toBe("aps");
    const historyBefore = s().history.length;
    s().undo();
    expect(s().datasets[0].name).toBe("a.csv");
    expect(view().plotTemplate).toBe("aps");
    expect(s().history.length).toBe(historyBefore - 1); // no history entry of its own
  });
});
