// Plot > Exchange X-Y axes (`PlotView.exchangeXY`): the layer turns on its side.
// The screen leg of the shared wire table (tests/fixtures/wire/exchange_xy.json,
// whose export leg is tests/test_calc_figure_exchange_xy.py), the command and
// its disabled reasons, the context-menu entry, undo, and persistence.
vi.hoisted(() => {
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import uPlot from "uplot";

import { buildPlotCommands } from "../commands/plotCommands";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { exchangeAxisClash, exchangeBlocker, type ExchangeState } from "./exchangeXY";
import { viewOverrides } from "./figureViewOverrides";
import type { PlotPayload } from "./plotdata";
import { buildPlotMenu, type PlotMenuContext } from "./plotMenu";
import type { FigureDocument } from "./figureDocument";
import { withValidFigureLayers, withValidLayers } from "./graphLayersSanitize";
import { defaultPlotView, sanitizePlotView, type PlotWindow } from "./plotview";
import { buildOpts } from "./uplotOpts";
import { orientArgs, orientAxes } from "./uplotOrient";

interface Case {
  name: string;
  x: { title: string; scale: "linear" | "log"; lim: [number, number] | null; reversed: boolean };
  y: { title: string; scale: "linear" | "log"; lim: [number, number] | null };
  data: { x: number[]; y: number[] };
  vertical: "x";
}
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "exchange_xy.json");
const table = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[]; conflicts: string[] };
const cases = table.cases;

const payload = (xLabel: string, yLabel: string, data = { x: [1, 10, 100], y: [20, 300, 5000] }): PlotPayload => ({
  data: [data.x, data.y] as PlotPayload["data"],
  series: [{ label: yLabel, unit: "" }],
  xLabel,
  xUnit: "",
});

function opts(c: Case, exchangeXY: boolean): uPlot.Options {
  return buildOpts(payload(c.x.title, c.y.title, c.data), {
    width: 600, height: 400, tool: "zoom", onReadout: vi.fn(), linearPaths: uPlot.paths.linear!(),
    xScale: c.x.scale, yScale: c.y.scale, xLim: c.x.lim, yLim: c.y.lim, xReversed: c.x.reversed,
    xAxisLabel: c.x.title, yAxisLabel: c.y.title, exchangeXY,
  });
}

describe("the screen leg of the exchange wire table", () => {
  it.each(cases)("$name", (c) => {
    const o = opts(c, true);
    // X is the vertical scale and keeps its direction, scale type and range
    expect(o.scales!.x).toMatchObject({ ori: 1, dir: c.x.reversed ? -1 : 1 });
    expect(o.scales!.y).toMatchObject({ ori: 0 });
    expect(o.scales!.x.distr).toBe(c.x.scale === "log" ? 3 : 1);
    expect(o.scales!.y.distr).toBe(c.y.scale === "log" ? 3 : 1);
    const xr = o.scales!.x.range as unknown;
    if (c.x.lim) expect(typeof xr === "function" ? (xr as () => unknown)() : xr).toEqual(c.x.lim);
    // the X axis (and its title) sits on the LEFT (side 3), the Y axis along the BOTTOM (side 2)
    const [ax, ay] = o.axes!;
    expect(ax).toMatchObject({ side: 3, label: c.x.title });
    expect(ay).toMatchObject({ side: 2, label: c.y.title });
  });

  it.each(cases)("$name: without the toggle the plot is upright", (c) => {
    const o = opts(c, false);
    expect(o.scales!.x.ori).toBeUndefined();
    expect(o.axes![0].side).not.toBe(3);
  });

  it("is turned once: bars AND the toggle give the same axes as either alone", () => {
    const c = cases[0];
    const bars = orientAxes({ x: {}, y: {} }, [{}, {}], [{ bars: "horizontal" }]);
    expect(orientAxes({ x: {}, y: {} }, [{}, {}], [{ bars: "horizontal" }], true)).toEqual(bars);
    expect(orientAxes({ x: {}, y: {} }, [{}, {}], undefined, true)).toEqual(bars);
    expect(opts(c, true).scales!.x.ori).toBe(1);
  });

  it("switches the pointer-driven tools off, as on a horizontal bar graph", () => {
    const given = { tool: "pan" as const, wheelZoom: true, exchangeXY: true };
    expect(orientArgs(given)).toMatchObject({ tool: "zoom", wheelZoom: false });
    expect(orientArgs({ ...given, exchangeXY: false }).tool).toBe("pan");
  });
});

describe("export wire", () => {
  it("rides as exchange_xy only while on", () => {
    expect(viewOverrides({ ...defaultPlotView(), exchangeXY: true })?.exchange_xy).toBe(true);
    expect(viewOverrides(defaultPlotView())?.exchange_xy).toBeUndefined();
  });
});

describe("exchangeBlocker", () => {
  const ok: ExchangeState = {
    exchangeXY: false, stageTab: "plot", polarMode: false, statMode: false, stackMode: false, insetMode: false,
    facetKey: null, composition: null, yFmt: defaultPlotView().yFmt, y2Fmt: null,
  };
  it("allows a plain X-Y plot", () => expect(exchangeBlocker(ok)).toBeUndefined());
  it.each([
    ["map", { stageTab: "map" }],
    ["polar", { polarMode: true }],
    ["statistics", { statMode: true }],
    ["stack", { stackMode: true }],
    ["facet", { facetKey: 2 }],
    ["break layout", { composition: { kind: "break" } }],
    ["broken Y axis", { yFmt: { ...ok.yFmt, breaks: [[1, 2]] as [number, number][] } }],
    ["broken Y2 axis", { y2Fmt: { ...ok.yFmt, breaks: [[1, 2]] as [number, number][] } }],
    ["inset", { insetMode: true }],
    ["top X axis", { xFmt: { ...ok.yFmt, top: { kind: "reciprocal" as const, factor: 1 } } }],
    ["Y3+ axes", { yAxes: [{}] }],
    ["horizontal bars (already turned)", { seriesStyles: { 0: { bars: "horizontal" as const } } }],
  ])("refuses %s with a reason", (_n, patch) => {
    expect(exchangeBlocker({ ...ok, ...patch })).toMatch(/^Not available for /);
  });
  it("the shared table's conflicts are all covered by the blocker", () => {
    const names = ["inset", "y breaks", "y2 breaks", "top x axis", "y3+ axes", "x breaks"];
    expect(table.conflicts).toEqual(names);
    const patches: Record<string, Partial<ExchangeState>> = {
      inset: { insetMode: true },
      "y breaks": { yFmt: { ...ok.yFmt, breaks: [[1, 2]] } },
      "y2 breaks": { y2Fmt: { ...ok.yFmt, breaks: [[1, 2]] } },
      "top x axis": { xFmt: { ...ok.yFmt, top: { kind: "reciprocal", factor: 1 } } },
      "y3+ axes": { yAxes: [{}] },
      "x breaks": { composition: { kind: "break" } },
    };
    for (const n of names) expect(exchangeBlocker({ ...ok, ...patches[n] }), n).toMatch(/^Not available for /);
  });
  it("a saved x-break in the focused window's document blocks it (no live composition needed)", () => {
    const w = (x: [number, number][], id = "w1") => [{ id, kind: "plot", document: { plot: { axisBreaks: { x } } } }];
    expect(exchangeBlocker({ ...ok, plotWindows: w([[20, 30]]), focusedWindowId: "w1" })).toBe("Not available for multi-panel layouts");
    expect(exchangeBlocker({ ...ok, plotWindows: w([]), focusedWindowId: "w1" })).toBeUndefined();
    expect(exchangeBlocker({ ...ok, plotWindows: w([[20, 30]]), focusedWindowId: "other" })).toBeUndefined();
  });
  it("lets an exchanged view be turned back whatever else is set", () => {
    expect(exchangeBlocker({ ...ok, exchangeXY: true, polarMode: true })).toBeUndefined();
  });
});

describe("the command and the store", () => {
  // The command reads the blocker from a lazy chunk it starts loading at import (fail closed until it lands).
  beforeEach(async () => {
    await import("./exchangeXY");
    await new Promise((r) => setTimeout(r, 0));
    useApp.setState({ exchangeXY: false, polarMode: false, stageTab: "plot", stackMode: false, facetKey: null, composition: null, insetMode: false, statMode: false });
  });
  afterEach(() => useApp.setState({ exchangeXY: false, polarMode: false }));

  const command = () => buildPlotCommands(useApp.getState).find((a) => a.id === "exchange-xy")!;
  const on = (a: { disabled?: boolean | (() => boolean) }) => (typeof a.disabled === "function" ? a.disabled() : a.disabled);

  it("is a checked Plot > Axes command that toggles the view", () => {
    const a = command();
    expect(a).toMatchObject({ group: "Plot", section: "Axes", label: "Exchange X–Y axes" });
    expect((a.checked as () => boolean)()).toBe(false);
    a.run();
    expect(useApp.getState().exchangeXY).toBe(true);
    expect((a.checked as () => boolean)()).toBe(true);
  });

  it("is one undo step, and toggling twice is the identity", () => {
    const before = useApp.getState().exchangeXY;
    command().run();
    command().run();
    expect(useApp.getState().exchangeXY).toBe(before);
    command().run();
    expect(useApp.getState().exchangeXY).toBe(true);
    useApp.getState().undo();
    expect(useApp.getState().exchangeXY).toBe(false); // ONE undo undoes the one toggle
  });

  it("is disabled with the reason on a polar plot, and a palette pick then does nothing", () => {
    useApp.setState({ polarMode: true });
    const a = command();
    expect(on(a)).toBe(true);
    expect((a.disabledReason as () => string)()).toBe("Not available for polar plots");
    useToasts.setState({ toasts: [] });
    a.run();
    expect(useApp.getState().exchangeXY).toBe(false);
    expect(useToasts.getState().toasts.map((t) => t.msg)).toEqual(["Not available for polar plots"]); // the palette says why
  });

  it("the magnifier inset command is off while exchanged (it does not turn), with the reason", () => {
    const inset = buildPlotCommands(useApp.getState).find((x) => x.id === "inset-mode")!;
    const off = () => (typeof inset.disabled === "function" ? inset.disabled() : inset.disabled);
    expect(off()).toBe(false);
    useApp.setState({ exchangeXY: true });
    expect(off()).toBe(true);
    expect(inset.disabledReason).toBe("Not available on a turned plot");
  });

  it("is off on a horizontal bar graph, saying it is already turned (a checked state must not lie)", () => {
    useApp.setState({ seriesStyles: { 0: { bars: "horizontal" } } });
    try {
      const a = command();
      expect(on(a)).toBe(true);
      expect((a.disabledReason as () => string)()).toBe("Not available for horizontal bars (already turned)");
      a.run();
      expect(useApp.getState().exchangeXY).toBe(false);
    } finally {
      useApp.setState({ seriesStyles: {} });
    }
  });

  it("the context menu offers the same toggle, checked and disabled the same way", () => {
    const base = { series: null, zone: "plot", hasY2: false } as unknown as PlotMenuContext;
    const toggle = vi.fn();
    const entry = (ex: PlotMenuContext["exchange"]) =>
      buildPlotMenu({ ...base, exchange: ex } as PlotMenuContext).find((i) => "label" in i && i.label === "Exchange X–Y axes");
    expect(entry({ on: true, toggle })).toMatchObject({ checked: true, disabled: false });
    expect(entry({ on: false, blocker: "Not available for maps", toggle })).toMatchObject({ disabled: true, title: "Not available for maps" });
    expect(entry(undefined)).toBeUndefined();
  });
});

describe("exchangeAxisClash", () => {
  const d = { breakFrom: "", breakTo: "", topKind: "none" as const };
  it("flags a Y break or a top X axis only while exchanged", () => {
    expect(exchangeAxisClash(true, "y", { ...d, breakFrom: "1" })).toMatch(/exchanged/);
    expect(exchangeAxisClash(true, "y2", { ...d, breakTo: "2" })).toMatch(/exchanged/);
    expect(exchangeAxisClash(true, "x", { ...d, topKind: "reciprocal" })).toMatch(/exchanged/);
    expect(exchangeAxisClash(false, "y", { ...d, breakFrom: "1" })).toBe("");
    expect(exchangeAxisClash(true, "y", d)).toBe("");
    expect(exchangeAxisClash(true, "x", { ...d, breakFrom: "1" })).toBe(""); // an X draft has no break
  });
});

describe("a saved view holding both", () => {
  const win = (view: Partial<ReturnType<typeof defaultPlotView>>) =>
    ({ id: "w", kind: "plot", view: { ...defaultPlotView(), exchangeXY: true, ...view } }) as unknown as PlotWindow;

  it("loses the exchange when it also holds something the turn cannot draw", () => {
    expect(withValidLayers(win({})).view.exchangeXY).toBe(true);
    expect(withValidLayers(win({ insetMode: true })).view.exchangeXY).toBe(false);
    expect(withValidLayers(win({ polarMode: true })).view.exchangeXY).toBe(false);
    expect(withValidLayers(win({ facetKey: 1 })).view.exchangeXY).toBe(false);
    expect(withValidLayers(win({ yFmt: { ...defaultPlotView().yFmt, breaks: [[1, 2]] } })).view.exchangeXY).toBe(false);
    expect(withValidLayers(win({ seriesStyles: { 0: { bars: "horizontal" } } })).view.exchangeXY).toBe(false);
    expect(withValidLayers(win({ insetMode: true })).view.insetMode).toBe(true); // the rest of the view is kept
  });

  it("a saved x-break in the window's document counts (Break at gaps, the Figure Builder)", () => {
    const withBreak = (x: [number, number][]) =>
      ({ ...win({}), document: { plot: { view: { ...defaultPlotView(), exchangeXY: true }, axisBreaks: { x, y: [] } }, bindings: { facetKey: null } } }) as unknown as PlotWindow;
    expect(withValidLayers(withBreak([[20, 30]])).view.exchangeXY).toBe(false);
    expect(withValidLayers(withBreak([])).view.exchangeXY).toBe(true);
    const doc = (x: [number, number][]) =>
      ({ plot: { view: { ...defaultPlotView(), exchangeXY: true }, axisBreaks: { x, y: [] } }, bindings: { facetKey: null } }) as unknown as FigureDocument;
    expect(withValidFigureLayers(doc([[20, 30]])).plot.view.exchangeXY).toBe(false);
    expect(withValidFigureLayers(doc([])).plot.view.exchangeXY).toBe(true);
  });

  it("and so does a saved figure document's own view (its facet binding counts)", () => {
    const doc = (view: object, facetKey: number | null) =>
      ({ plot: { view: { ...defaultPlotView(), exchangeXY: true, ...view }, axisBreaks: { x: [], y: [] } }, bindings: { facetKey } }) as unknown as FigureDocument;
    expect(withValidFigureLayers(doc({}, null)).plot.view.exchangeXY).toBe(true);
    expect(withValidFigureLayers(doc({ insetMode: true }, null)).plot.view.exchangeXY).toBe(false);
    expect(withValidFigureLayers(doc({}, 2)).plot.view.exchangeXY).toBe(false);
  });
});

describe("persistence", () => {
  it("survives the view sanitizer, and defaults off", () => {
    expect(defaultPlotView().exchangeXY).toBe(false);
    expect(sanitizePlotView({ ...defaultPlotView(), exchangeXY: true }).exchangeXY).toBe(true);
    expect(sanitizePlotView({ exchangeXY: "yes" }).exchangeXY).toBe(false);
  });
});
