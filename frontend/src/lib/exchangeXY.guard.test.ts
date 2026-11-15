// The live guard (`installExchangeGuard`, lib/exchangeXY.ts): while X and Y are exchanged, what the
// turn cannot draw is refused or clears the exchange -- never both standing.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { toast, useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { installExchangeGuard } from "./exchangeXY";
import { defaultPlotView } from "./plotview";

beforeAll(() => {
  installExchangeGuard(useApp, toast);
  installExchangeGuard(useApp, toast); // idempotent: one subscription, one toast per refusal
});

const toasts = () => useToasts.getState().toasts.map((t) => t.msg);
const base = { ...defaultPlotView(), composition: null, stageTab: "plot" as const };

beforeEach(() => {
  useApp.setState({ ...base, exchangeXY: true });
  useToasts.setState({ toasts: [] });
});

describe("an edit that adds what the turn cannot draw, while exchanged, is refused", () => {
  it("an inset", () => {
    useApp.getState().setInsetMode(true);
    expect(useApp.getState().insetMode).toBe(false);
    expect(useApp.getState().exchangeXY).toBe(true);
    expect(toasts().join()).toMatch(/Not applied: insets can't be set while X and Y are exchanged/);
  });

  it("a Y axis break", () => {
    useApp.getState().setYFmt({ ...useApp.getState().yFmt, breaks: [[1, 2]] });
    expect(useApp.getState().yFmt.breaks).toBeUndefined();
    expect(useApp.getState().exchangeXY).toBe(true);
    expect(toasts().join()).toMatch(/broken axes/);
  });

  it("a top X axis", () => {
    useApp.getState().setXFmt({ ...useApp.getState().xFmt, top: { kind: "reciprocal", factor: 1 } });
    expect(useApp.getState().xFmt.top).toBeUndefined();
    expect(useApp.getState().exchangeXY).toBe(true);
  });

  it("a Y3+ axis", () => {
    useApp.setState({ yAxes: [{ lim: null, scale: null, step: null, fmt: null, label: "R3", color: null }] });
    expect(useApp.getState().yAxes).toEqual([]);
    expect(useApp.getState().exchangeXY).toBe(true);
  });
});

describe("a mode the exchange does not draw clears it, saying so", () => {
  it.each([
    ["polar", { polarMode: true }, /polar plots/],
    ["statistics", { statMode: true }, /statistics plots/],
    ["stack", { stackMode: true }, /multi-panel layouts/],
    ["facet", { facetKey: 1 }, /multi-panel layouts/],
    ["horizontal bars", { seriesStyles: { 0: { bars: "horizontal" as const } } }, /horizontal bars/],
  ])("%s", (_n, patch, msg) => {
    useApp.setState(patch);
    expect(useApp.getState().exchangeXY).toBe(false);
    expect(toasts().join()).toMatch(msg);
    expect(toasts().join()).toMatch(/Exchange X–Y axes turned off/);
  });

  it("a view that arrives holding both (a window switch, a restore)", () => {
    useApp.setState({ exchangeXY: false });
    useApp.setState({ exchangeXY: true, insetMode: true });
    expect(useApp.getState().exchangeXY).toBe(false);
    expect(useApp.getState().insetMode).toBe(true); // the view itself is kept
  });
});

describe("what is not an edit leaves the exchange alone", () => {
  it("opening the Map tab", () => {
    useApp.setState({ stageTab: "map" });
    expect(useApp.getState().exchangeXY).toBe(true);
  });
  it("turning the exchange back off with an inset present", () => {
    useApp.setState({ exchangeXY: false, insetMode: true });
    expect(useApp.getState().insetMode).toBe(true);
  });
  it("an edit that conflicts with nothing", () => {
    useApp.getState().setShowGrid(false);
    expect(useApp.getState().exchangeXY).toBe(true);
    expect(toasts()).toEqual([]);
  });
});
