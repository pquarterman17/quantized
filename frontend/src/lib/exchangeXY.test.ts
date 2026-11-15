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
import { useApp } from "../store/useApp";
import { exchangeBlocker, type ExchangeState } from "./exchangeXY";
import { viewOverrides } from "./figureViewOverrides";
import type { PlotPayload } from "./plotdata";
import { buildPlotMenu, type PlotMenuContext } from "./plotMenu";
import { defaultPlotView, sanitizePlotView } from "./plotview";
import { buildOpts } from "./uplotOpts";
import { orientArgs, orientAxes } from "./uplotOrient";

interface Case {
  name: string;
  x: { title: string; scale: "linear" | "log"; lim: [number, number] | null; reversed: boolean };
  y: { title: string; scale: "linear" | "log"; lim: [number, number] | null };
  vertical: "x";
}
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "exchange_xy.json");
const cases = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }).cases;

const payload = (xLabel: string, yLabel: string): PlotPayload => ({
  data: [[1, 10, 100], [20, 300, 5000]] as PlotPayload["data"],
  series: [{ label: yLabel, unit: "" }],
  xLabel,
  xUnit: "",
});

function opts(c: Case, exchangeXY: boolean): uPlot.Options {
  return buildOpts(payload(c.x.title, c.y.title), {
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
    ["inset", { insetMode: true }],
  ])("refuses %s with a reason", (_n, patch) => {
    expect(exchangeBlocker({ ...ok, ...patch })).toMatch(/^Not available for /);
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
    a.run();
    expect(useApp.getState().exchangeXY).toBe(false);
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

describe("persistence", () => {
  it("survives the view sanitizer, and defaults off", () => {
    expect(defaultPlotView().exchangeXY).toBe(false);
    expect(sanitizePlotView({ ...defaultPlotView(), exchangeXY: true }).exchangeXY).toBe(true);
    expect(sanitizePlotView({ exchangeXY: "yes" }).exchangeXY).toBe(false);
  });
});
